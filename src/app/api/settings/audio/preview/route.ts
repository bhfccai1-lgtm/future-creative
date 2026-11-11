import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { getSecret, getSettings } from '@/lib/settings';
import { AppError } from '@/lib/errors';
import { getAiProvider } from '@/lib/ai';
import { recordUsage, estimateTextCost } from '@/lib/ai/cost';
import { openaiSpeak, sanitizeScript, estimateTtsCost } from '@/lib/audio/tts';
import { PERSONAS, VOICE_LANGS, personaOf, voiceLangOf, wordsFor } from '@/lib/audio/voices';

const Body = z.object({ persona: z.string().max(40), voiceLang: z.string().max(40), group: z.string().max(30).optional() });
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
  if (provider.writeVoiceover && !provider.isDryRun) {
    const w = await provider.writeVoiceover({ language: lang.prompt, persona: persona.acting, seconds: 6, maxWords, copy: { headline: 'أكواب بتصميمك', badge: 'الأكواب', support: 'هدية تبقى ذكرى', cta: 'اطلب الآن' }, product: { titleEn: 'Custom printed mugs', titleAr: 'أكواب مطبوعة' } }, s.ai.textModel);
    await recordUsage({ provider: provider.name, model: w.model, kind: 'text', inputTokens: w.usage.inputTokens, outputTokens: w.usage.outputTokens, costUsd: estimateTextCost(s, w.usage.inputTokens, w.usage.outputTokens) });
    script = sanitizeScript(w.script, maxWords) ?? script;
  }
  const v = await openaiSpeak(key, script, { persona, lang });
  await recordUsage({ provider: 'openai', model: v.model, kind: 'audio', costUsd: estimateTtsCost(v.chars) });
  return new Response(new Uint8Array(v.audio), { headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store', 'x-voice-script': encodeURIComponent(script) } });
});
