import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { setSecret, updateSettings } from '@/lib/settings';
import { setAiProviderOverride } from '@/lib/ai';
import { generateAdvertisement } from '@/lib/pipeline/generate';
import { fakeSpeech } from '@/lib/audio/tts';
import { missedSuggestions } from '@/lib/audio/pron-learn';
import { captureQueues, FakeAiProvider, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });
afterEach(() => { vi.unstubAllGlobals(); setAiProviderOverride(null); });

describe('voice-over pronunciation: lexicon → speech → listen back → clearer re-take', () => {
  it('re-takes slower when words were not understood, keeps the clear take and reports it in QC', async () => {
    const { accounts } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false } }) });
    await setSecret('OPENAI_API_KEY', 'sk-test', 't');
    await updateSettings((s) => ({ ...s, ai: { ...s.ai, audio: { ...s.ai.audio, lexicon: [{ from: 'بتصميمك', to: 'بِتَصْمِيمَك' }] } } }));
    setAiProviderOverride(new FakeAiProvider());
    const speech: { input: string; instructions: string }[] = []; let stt = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/audio/speech')) { const b = JSON.parse(String(init!.body)); speech.push(b); return new Response(new Uint8Array(fakeSpeech(b.input)), { status: 200 }); }
      if (u.endsWith('/audio/transcriptions')) {
        stt++;
        const said = speech[speech.length - 1].input;
        return new Response(JSON.stringify({ text: stt === 1 ? said.split(' ').slice(0, 2).join(' ') : said }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`unexpected ${u}`);
    }));
    const r = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'REEL_VIDEO', direction: { audio: 'voiceover', renderMode: 'layered' } });
    expect(speech).toHaveLength(2); // first take unclear → one slower re-take
    expect(speech[0].instructions).toMatch(/Articulation/);
    expect(speech[1].instructions).toMatch(/slower[\s\S]*Pronounce every word fully/);
    const ad = await prisma.advertisement.findUniqueOrThrow({ where: { id: r.advertisement.id } });
    const used = (ad.options as { audioUsed: { pronunciation: { accuracy: number; takes: number; pace: string } } }).audioUsed;
    expect(used.pronunciation).toMatchObject({ accuracy: 1, takes: 2, pace: 'slow' });
    const qc = ad.qcReport as unknown as { checks: { id: string; passed: boolean }[] };
    expect(qc.checks.find((c) => c.id === 'voice_pronunciation')?.passed).toBe(true);
  }, 300_000);

  it('the re-take reads a fully vocalised script (same words, verified) and the stumbles are offered for the dictionary', async () => {
    const { accounts } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false } }) });
    await setSecret('OPENAI_API_KEY', 'sk-test', 't');
    // a text model that vocalises: adds a fatha to every Arabic word (keeps the words) — the check accepts it
    class Vocaliser extends FakeAiProvider {
      calls = 0;
      async generateJson(_s: string, user: string) {
        this.calls++;
        const { text } = JSON.parse(user) as { text: string };
        return { json: { text: text.replace(/([\u0621-\u064A])(?=\s|$)/g, '$1َ') }, usage: { inputTokens: 200, outputTokens: 120 }, model: 'fake-text' };
      }
    }
    const ai = new Vocaliser(); setAiProviderOverride(ai);
    const speech: { input: string }[] = []; let stt = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/audio/speech')) { const b = JSON.parse(String(init!.body)); speech.push(b); return new Response(new Uint8Array(fakeSpeech(b.input)), { status: 200 }); }
      if (u.endsWith('/audio/transcriptions')) {
        stt++;
        const said = speech[speech.length - 1].input;
        return new Response(JSON.stringify({ text: stt === 1 ? said.split(' ').slice(0, 2).join(' ') : said }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`unexpected ${u}`);
    }));
    await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'REEL_VIDEO', direction: { audio: 'voiceover', renderMode: 'layered' } });
    expect(speech).toHaveLength(2);
    expect(speech[1].input).not.toBe(speech[0].input); // the re-take is vocalised …
    expect(speech[1].input.replace(/[\u064B-\u0652]/g, '')).toBe(speech[0].input.replace(/[\u064B-\u0652]/g, '')); // … with exactly the same words
    const stumbles = await missedSuggestions([]);
    expect(stumbles.length).toBeGreaterThan(0);
    expect(stumbles[0].count).toBe(1);
    expect(stumbles.some((m) => m.suggestion && /[\u064B-\u0652]/.test(m.suggestion))).toBe(true);
    // a word already in the dictionary is not offered again
    expect((await missedSuggestions([{ from: stumbles[0].word }])).some((m) => m.word === stumbles[0].word)).toBe(false);
  }, 300_000);
});
