import { AiProviderError } from '../ai/types';

/**
 * Voice-over via OpenAI text-to-speech (same OpenAI key as the designs). Only VERIFIED copy is spoken
 * (headline, supporting line, CTA) — never phone numbers, prices or invented claims.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../video/probe';
import { findClaims } from '../qc/checks';
import type { Persona, VoiceLang } from './voices';

/**
 * The feeling of the read, from the occasion first (it is the strongest emotional cue), then the product category.
 * Real feeling, matched to why people buy: a gift is affection, a wedding is joy, a company order is trust.
 */
export function voiceMood(o: { category?: string | null; occasion?: string | null }): string {
  const oc = o.occasion ?? '', c = o.category ?? '';
  if (/national_day/.test(oc)) return 'proud, uplifting and warm, a festive national spirit';
  if (/ramadan|gergaoon|eid/.test(oc)) return 'warm festive joy and family spirit, generous and heartfelt';
  if (/mothers_day|women_day/.test(oc)) return 'tender, loving and grateful, from the heart';
  if (/wedding/.test(oc) || /أعراس|حفلات|زفاف/.test(c)) return 'joyful and elegant, a sparkle of celebration';
  if (/graduation|teachers_day|back_to_school/.test(oc) || /أطفال|مدارس|مدرس|تعليم/.test(c)) return 'cheerful, proud and caring, bright and encouraging';
  if (/diwali|onam|new_year/.test(oc)) return 'bright, festive and welcoming';
  if (/هدايا|تذكار|هدية/.test(c)) return 'heartfelt warmth and affection, like recommending a gift to a dear friend';
  if (/شركات|موظف|مكتب|عقار|معارض|مؤتمر/.test(c)) return 'confident, trustworthy and professional, with friendly warmth';
  return 'friendly, upbeat and warm, genuinely excited to share something nice';
}

/** Acting + accent + articulation + emotional arc instructions for the TTS model. */
export function ttsInstructions(persona: Persona, lang: VoiceLang, o: { pace?: 'slow' | 'normal' | 'fast'; note?: string; mood?: string; emphasis?: string; brand?: string } = {}) {
  const pace = o.pace === 'slow' ? 'Pace: a little slower than usual, every syllable clear.' : o.pace === 'fast' ? 'Pace: lively and quick, yet every word still clear.' : 'Pace: natural commercial pace.';
  return [
    `Voice: ${persona.acting}.`,
    `Language and accent: ${lang.prompt}. Sound like a native speaker of exactly this variety.`,
    'Articulation: pronounce every word completely and correctly. For Arabic, give each letter its true sound — ع، ح، خ، غ، ق، ض، ظ، ص، ط — never anglicise or swallow them; follow the diacritics (tashkeel) where written; read English trade words written in Arabic letters as written. Finish the last syllable of every word, especially at the end of a phrase.',
    pace,
    `Emotion: ${o.mood ?? 'friendly, upbeat and warm'} — real feeling the listener can hear, never over-acted or theatrical.`,
    'Emotional journey: OPENING — the first line grabs attention with genuine curiosity or excitement (a question rises naturally, then a tiny pause); MIDDLE — warm, sincere, like telling a small true story; CLIMAX — one line of real delight, the brightest moment of the read; ENDING — slow down slightly and give the call to action with confident, persuasive warmth and a smile. Deliver each sentence according to its own meaning.',
    'Rhythm: natural micro-pauses between phrases (at «،» «…» and line breaks), breathe like a person, vary the intonation — never flat, robotic or rushed.',
    o.emphasis ? `Emphasis: give gentle, warm stress to «${o.emphasis}» the first time it is said.` : '',
    o.brand ? `Brand name: say «${o.brand}» clearly and proudly, every word complete, without rushing.` : '',
    'Read the text exactly as written — do not add, drop or change words.',
    o.note ?? '',
  ].filter(Boolean).join(' ');
}

/** Removes anything that must never be spoken; null when the script breaks the ad rules (caller falls back to the verified copy). */
export function sanitizeScript(script: string, maxWords: number): string | null {
  // short numbers stay (they are spoken as words later); long digit runs — phone numbers — are never read
  const clean = script.replace(/https?:\/\/\S+|www\.\S+|#\S+|\+?[0-9٠-٩۰-۹][0-9٠-٩۰-۹\s-]{6,}[0-9٠-٩۰-۹]|[0-9٠-٩۰-۹]{5,}/g, '').replace(/["“”«»]/g, '').replace(/\s+/g, ' ').trim();
  if (!clean || findClaims(clean).length) return null;
  const words = clean.split(' ');
  return words.length > maxWords + 4 ? words.slice(0, maxWords).join(' ') : clean;
}

/** Spoken script built from verified layers only. URLs and long digit runs are dropped; short numbers are spoken as words. */
export function voiceScript(p: { headline: string; badge?: string | null; support?: string | null; cta?: string | null }) {
  const parts = [p.headline, p.badge, p.support, p.cta].map((x) => (x ?? '').replace(/https?:\/\/\S+|www\.\S+|[0-9٠-٩]{5,}/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  return [...new Set(parts)].join('… ');
}

export async function openaiSpeak(apiKey: string, text: string, o: { persona: Persona; lang: VoiceLang; model?: string; pace?: 'slow' | 'normal' | 'fast'; note?: string; mood?: string; emphasis?: string; brand?: string }): Promise<{ audio: Buffer; model: string; chars: number }> {
  const model = o.model ?? 'gpt-4o-mini-tts';
  let r: Response;
  try {
    r = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST', signal: AbortSignal.timeout(60_000),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, voice: o.persona.voice, input: text.slice(0, 1500), instructions: ttsInstructions(o.persona, o.lang, { pace: o.pace, note: o.note, mood: o.mood, emphasis: o.emphasis, brand: o.brand }), response_format: 'wav' }),
    });
  } catch (e) { throw new AiProviderError('NETWORK', `TTS: ${(e as Error).message}`, true); }
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    const code = r.status === 401 ? 'AUTH' : r.status === 429 ? 'RATE_LIMIT' : r.status === 402 ? 'BILLING' : 'UNKNOWN';
    throw new AiProviderError(code, `TTS HTTP ${r.status}: ${body.slice(0, 200)}`, r.status === 429 || r.status >= 500);
  }
  return { audio: await shapeVoice(Buffer.from(await r.arrayBuffer()), o.persona), model, chars: text.length };
}

/** Child / elderly personas: pitch + formant shift (rubberband; asetrate fallback) and tempo, so the voice sounds the right age. */
export async function shapeVoice(wav: Buffer, persona: Persona): Promise<Buffer> {
  const pitch = persona.pitch ?? 1, tempo = persona.tempo ?? 1;
  if (pitch === 1 && tempo === 1) return wav;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-vo-'));
  try {
    const i = path.join(dir, 'in.wav'), o = path.join(dir, 'out.wav');
    await fs.writeFile(i, wav);
    const ff = process.env.FFMPEG_PATH ?? 'ffmpeg';
    let r = await run(ff, ['-y', '-loglevel', 'error', '-i', i, '-af', `rubberband=pitch=${pitch}:tempo=${tempo}:formant=shifted`, o], 60_000);
    if (r.code !== 0) r = await run(ff, ['-y', '-loglevel', 'error', '-i', i, '-af', `asetrate=24000*${pitch},aresample=24000,atempo=${(tempo / pitch).toFixed(4)}`, o], 60_000);
    return r.code === 0 ? fs.readFile(o) : wav;
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

/** Deterministic stand-in for tests / dry-run: a soft tone with the length a voice-over would have. */
export function fakeSpeech(text: string): Buffer {
  const sec = Math.min(8, Math.max(1.5, text.length / 14)), rate = 24000, n = Math.round(sec * rate);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 6000 * (0.6 + 0.4 * Math.sin((2 * Math.PI * 3 * i) / rate))), 44 + i * 2);
  return b;
}

/** gpt-4o-mini-tts is billed per audio minute (~$0.015/min). */
export const estimateTtsCost = (chars: number) => Math.round(((chars / 14) / 60) * 0.015 * 10000) / 10000 || 0.0005;

/** Listen back: transcribe a generated voice-over (OpenAI speech-to-text) so its words can be checked against the script. */
export async function openaiTranscribe(apiKey: string, audio: Buffer, language?: string): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'voice.wav');
  form.append('model', 'gpt-4o-mini-transcribe');
  if (language && /^[a-z]{2}$/.test(language)) form.append('language', language);
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new AiProviderError('UNKNOWN', `STT HTTP ${r.status}`, r.status >= 500);
  return String(((await r.json()) as { text?: string }).text ?? '');
}
/** ≈ USD for transcribing a short voice-over (gpt-4o-mini-transcribe ≈ $0.003/min). */
export const estimateSttCost = (seconds: number) => Math.max(0.0002, Math.round((seconds / 60) * 0.003 * 10000) / 10000);
