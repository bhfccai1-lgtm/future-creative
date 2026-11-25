import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { getSecret, getSettings } from '@/lib/settings';
import { AppError } from '@/lib/errors';
import { getAiProvider } from '@/lib/ai';
import { recordUsage, estimateTextCost } from '@/lib/ai/cost';
import { openaiSpeak, openaiTranscribe, sanitizeScript, estimateTtsCost, estimateSttCost, voiceMood } from '@/lib/audio/tts';
import { missedWords, prepareSpoken, speakVerified } from '@/lib/audio/pronounce';
import { recordMissed, vocaliseFix } from '@/lib/audio/pron-learn';
import { PERSONAS, VOICE_LANGS, personaOf, voiceLangOf, wordsFor } from '@/lib/audio/voices';

const Body = z.object({
  persona: z.string().max(40), voiceLang: z.string().max(40), group: z.string().max(30).optional(),
  /** «جرّب جملة»: the owner's own sentence instead of an AI-written sample */
  text: z.string().trim().max(220).optional(),
  pace: z.enum(['slow', 'normal', 'fast']).optional(),
  lexicon: z.array(z.object({ from: z.string().trim().min(1).max(60), to: z.string().trim().min(1).max(80) })).max(150).optional(),
});
/** Real sample (≈ $0.003): the AI writes a short line in the chosen dialect for the persona, then it is spoken. Returns audio/wav. */
export const POST = api('settings:ai', async (req) => {
  const b = Body.parse(await req.json());
  const s = await getSettings();
  const key = await getSecret('OPENAI_API_KEY');
  if (!key) throw new AppError('NOT_CONFIGURED', 'مفتاح OpenAI غير مضبوط — العينة تحتاج المفتاح (إعدادات الذكاء الاصطناعي).', 412);
  const persona = personaOf(b.persona) ?? PERSONAS[0];
  const lang = voiceLangOf(b.voiceLang) ?? VOICE_LANGS.find((l) => l.group === (b.group ?? 'arabic')) ?? VOICE_LANGS[0];
  const provider = await getAiProvider(s);
  const maxWords = wordsFor(6, persona);
  let script = 'أكواب بتصميمك الخاص، هدية تبقى ذكرى، راسلنا على الخاص الحين';
  if (b.text) script = sanitizeScript(b.text, 60) ?? b.text.replace(/[0-9٠-٩]{5,}/g, '').trim();
  else if (provider.writeVoiceover && !provider.isDryRun) {
    const w = await provider.writeVoiceover({ language: lang.prompt, persona: persona.acting, seconds: 6, maxWords, copy: { headline: 'أكواب بتصميمك', badge: 'الأكواب', support: 'هدية تبقى ذكرى', cta: 'اطلب الآن' }, product: { titleEn: 'Custom printed mugs', titleAr: 'أكواب مطبوعة' } }, s.ai.textModel);
    await recordUsage({ provider: provider.name, model: w.model, kind: 'text', inputTokens: w.usage.inputTokens, outputTokens: w.usage.outputTokens, costUsd: estimateTextCost(s, w.usage.inputTokens, w.usage.outputTokens) });
    script = sanitizeScript(w.script, maxWords) ?? script;
  }
  // the same path as real reels: lexicon + numbers as words → speech → listen back → one clearer (vocalised) re-take if needed
  const spoken = prepareSpoken(script, b.lexicon ?? s.ai.audio.lexicon, lang.id);
  const pace = b.pace ?? s.ai.audio.pace;
  const r = await speakVerified(spoken, {
    pace: pace === 'slow' ? 'slow' : 'normal',
    speak: async (text, p, note) => { const v = await openaiSpeak(key, text, { persona, lang, pace: p === 'slow' ? 'slow' : pace, note, mood: voiceMood({ category: 'هدايا' }) }); await recordUsage({ provider: 'openai', model: v.model, kind: 'audio', costUsd: estimateTtsCost(v.chars) }); return v.audio; },
    transcribe: async (a) => { const t = await openaiTranscribe(key, a, lang.id.startsWith('ar') ? 'ar' : /^[a-z]{2}/.exec(lang.id)?.[0]); await recordUsage({ provider: 'openai', model: 'gpt-4o-mini-transcribe', kind: 'audio', costUsd: estimateSttCost(8) }); return t; },
    fix: vocaliseFix(provider, s),
  });
  const firstMissed = r.takes[0].accuracy !== null && r.takes[0].accuracy < 0.85 ? missedWords(spoken, r.takes[0].heard ?? '') : [];
  if (firstMissed.length) await recordMissed(firstMissed, spoken, r.takes[1]?.text !== spoken ? r.takes[1]?.text ?? null : null).catch(() => undefined);
  const headers: Record<string, string> = { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store', 'x-voice-script': encodeURIComponent(r.best.text), 'x-voice-takes': String(r.takes.length) };
  if (r.best.accuracy !== null) headers['x-voice-accuracy'] = String(r.best.accuracy);
  if (r.best.heard) headers['x-voice-heard'] = encodeURIComponent(r.best.heard.slice(0, 400));
  if (r.best.accuracy !== null && r.best.accuracy < 0.85) headers['x-voice-missed'] = encodeURIComponent(missedWords(r.best.text, r.best.heard ?? '').join('، '));
  return new Response(new Uint8Array(r.best.audio), { headers });
});
