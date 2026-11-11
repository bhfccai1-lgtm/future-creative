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

/** Acting + accent instructions for the TTS model. */
export function ttsInstructions(persona: Persona, lang: VoiceLang) {
  return [
    `Voice: ${persona.acting}.`,
    `Language and accent: ${lang.prompt}. Sound like a native speaker of exactly this variety.`,
    'Delivery: natural commercial read, clear diction, brief pauses at commas, smile in the voice where it fits. Read the text exactly as written.',
  ].join(' ');
}

/** Removes anything that must never be spoken; null when the script breaks the ad rules (caller falls back to the verified copy). */
export function sanitizeScript(script: string, maxWords: number): string | null {
  const clean = script.replace(/https?:\/\/\S+|www\.\S+|#\S+|[0-9٠-٩۰-۹]+/g, '').replace(/["“”«»]/g, '').replace(/\s+/g, ' ').trim();
  if (!clean || findClaims(clean).length) return null;
  const words = clean.split(' ');
  return words.length > maxWords + 4 ? words.slice(0, maxWords).join(' ') : clean;
}

/** Spoken script built from verified layers only. Digits and URLs are dropped. */
export function voiceScript(p: { headline: string; badge?: string | null; support?: string | null; cta?: string | null }) {
  const parts = [p.headline, p.badge, p.support, p.cta].map((x) => (x ?? '').replace(/https?:\/\/\S+|www\.\S+|[0-9٠-٩]+/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  return [...new Set(parts)].join('… ');
}

export async function openaiSpeak(apiKey: string, text: string, o: { persona: Persona; lang: VoiceLang; model?: string }): Promise<{ audio: Buffer; model: string; chars: number }> {
  const model = o.model ?? 'gpt-4o-mini-tts';
  let r: Response;
  try {
    r = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST', signal: AbortSignal.timeout(60_000),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, voice: o.persona.voice, input: text.slice(0, 1500), instructions: ttsInstructions(o.persona, o.lang), response_format: 'wav' }),
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
