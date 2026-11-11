import { AiProviderError } from '../ai/types';

/**
 * Voice-over via OpenAI text-to-speech (same OpenAI key as the designs). Only VERIFIED copy is spoken
 * (headline, supporting line, CTA) — never phone numbers, prices or invented claims.
 */
export const VOICES = [
  { value: 'onyx', ar: 'رجالي عميق (Onyx)' },
  { value: 'ash', ar: 'رجالي دافئ (Ash)' },
  { value: 'coral', ar: 'نسائي دافئ (Coral)' },
  { value: 'nova', ar: 'نسائي حيوي (Nova)' },
  { value: 'sage', ar: 'هادئ ومتزن (Sage)' },
] as const;
export type Voice = (typeof VOICES)[number]['value'];

const STYLE: Record<'ar' | 'en' | 'ml', string> = {
  ar: 'Speak natural Gulf Arabic (Bahraini) like a premium TV commercial voice-over: warm, confident, clear, medium pace, short pauses between phrases. Pronounce every Arabic word correctly.',
  en: 'Premium TV commercial voice-over: warm, confident, clear, medium pace, short pauses between phrases.',
  ml: 'Natural Malayalam commercial voice-over: warm, clear, medium pace.',
};

/** Spoken script built from verified layers only. Digits and URLs are dropped. */
export function voiceScript(p: { headline: string; badge?: string | null; support?: string | null; cta?: string | null }) {
  const parts = [p.headline, p.badge, p.support, p.cta].map((x) => (x ?? '').replace(/https?:\/\/\S+|www\.\S+|[0-9٠-٩]+/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  return [...new Set(parts)].join('… ');
}

export async function openaiSpeak(apiKey: string, text: string, o: { voice: Voice; lang: 'ar' | 'en' | 'ml'; model?: string }): Promise<{ audio: Buffer; model: string; chars: number }> {
  const model = o.model ?? 'gpt-4o-mini-tts';
  let r: Response;
  try {
    r = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST', signal: AbortSignal.timeout(60_000),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, voice: o.voice, input: text.slice(0, 1500), instructions: STYLE[o.lang], response_format: 'wav' }),
    });
  } catch (e) { throw new AiProviderError('NETWORK', `TTS: ${(e as Error).message}`, true); }
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    const code = r.status === 401 ? 'AUTH' : r.status === 429 ? 'RATE_LIMIT' : r.status === 402 ? 'BILLING' : 'UNKNOWN';
    throw new AiProviderError(code, `TTS HTTP ${r.status}: ${body.slice(0, 200)}`, r.status === 429 || r.status >= 500);
  }
  return { audio: Buffer.from(await r.arrayBuffer()), model, chars: text.length };
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
