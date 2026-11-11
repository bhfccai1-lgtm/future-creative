import { describe, expect, it, beforeAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { VeoProvider, VeoError, veoPrompt } from '@/lib/ai/veo';
import { run } from '@/lib/video/probe';

let clip: Buffer;
beforeAll(async () => {
  const f = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'veo-')), 'c.mp4');
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=720x1280:d=2:r=24', '-f', 'lavfi', '-i', 'sine=f=440:d=2', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', f]);
  clip = await fs.readFile(f);
});

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
function fakeGemini(script: (c: Call, n: number) => Response) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const c = { url, method: init.method ?? 'GET', headers: Object.fromEntries(new Headers(init.headers).entries()), body: init.body ? JSON.parse(String(init.body)) : null };
    calls.push(c);
    return script(c, calls.length);
  }) as unknown as typeof fetch;
  return { f, calls };
}
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const img = () => sharp({ create: { width: 1024, height: 1536, channels: 3, background: '#123456' } }).png().toBuffer();

describe('Gemini Veo provider (image-to-video, 9:16)', () => {
  it('starts a long-running job with the product frame, polls until done and downloads the MP4 with the key', async () => {
    const { f, calls } = fakeGemini((c, n) => {
      if (c.method === 'POST') return json({ name: 'models/veo-3.1-fast-generate-preview/operations/op1' });
      if (c.url.includes('/operations/op1')) return json(n < 3 ? { name: 'x', done: false } : { name: 'x', done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://generativelanguage.googleapis.com/v1beta/files/v1:download?alt=media' } }] } } });
      return new Response(new Uint8Array(clip), { status: 200 });
    });
    const r = await new VeoProvider({ apiKey: 'k-1', model: 'veo-3.1-fast-generate-preview', fetchImpl: f, pollMs: 1 }).generateVideo({ prompt: veoPrompt('a mug', 'premium'), image: await img(), durationSec: 8, resolution: '720p', negativePrompt: 'text' });
    expect(r.mp4.equals(clip)).toBe(true);
    const start = calls[0];
    expect(start.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-fast-generate-preview:predictLongRunning');
    expect(start.headers['x-goog-api-key']).toBe('k-1');
    expect(start.body).toMatchObject({ parameters: { aspectRatio: '9:16', durationSeconds: 8, resolution: '720p', negativePrompt: 'text' } });
    const frame = (start.body as { instances: { image: { bytesBase64Encoded: string } }[] }).instances[0].image.bytesBase64Encoded;
    expect(await sharp(Buffer.from(frame, 'base64')).metadata()).toMatchObject({ width: 720, height: 1280 }); // cropped to 9:16
    expect(calls.at(-1)!.headers['x-goog-api-key']).toBe('k-1'); // download authenticated
  });
  it('retries the first frame in the alternative field format when the API rejects the image field', async () => {
    const { f, calls } = fakeGemini((c) => {
      if (c.method === 'POST') return (c.body as { instances: { image: Record<string, unknown> }[] }).instances[0].image.bytesBase64Encoded
        ? json({ error: { message: 'Invalid JSON payload received. Unknown name "bytesBase64Encoded" at instances[0].image' } }, 400)
        : json({ name: 'ops/2' });
      if (c.url.endsWith('ops/2')) return json({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://dl/v' } }] } } });
      return new Response(new Uint8Array(clip));
    });
    await new VeoProvider({ apiKey: 'k', model: 'veo-x', fetchImpl: f, pollMs: 1 }).generateVideo({ prompt: 'p', image: await img() });
    expect((calls[1].body as { instances: { image: { inlineData: { mimeType: string } } }[] }).instances[0].image.inlineData.mimeType).toBe('image/png');
  });
  it('maps failures: bad key, quota, safety-filtered result, timeout', async () => {
    const mk = (resp: (c: Call) => Response, timeoutMs = 60_000) => new VeoProvider({ apiKey: 'k', model: 'veo-x', fetchImpl: fakeGemini(resp).f, pollMs: 1, timeoutMs });
    await expect(mk(() => json({ error: { message: 'API key not valid' } }, 403)).generateVideo({ prompt: 'p' })).rejects.toMatchObject({ code: 'AUTH' });
    await expect(mk(() => json({ error: { message: 'Resource exhausted' } }, 429)).generateVideo({ prompt: 'p' })).rejects.toMatchObject({ code: 'QUOTA' });
    await expect(mk((c) => c.method === 'POST' ? json({ name: 'o' }) : json({ done: true, response: { generateVideoResponse: { raiMediaFilteredCount: 1, raiMediaFilteredReasons: ['filtered'] } } })).generateVideo({ prompt: 'p' })).rejects.toMatchObject({ code: 'SAFETY' });
    await expect(mk((c) => c.method === 'POST' ? json({ name: 'o' }) : json({ done: false }), 5).generateVideo({ prompt: 'p' })).rejects.toBeInstanceOf(VeoError);
  });
  it('verify(): checks the key and lists the Veo models available to the account (no generation)', async () => {
    const { f, calls } = fakeGemini(() => json({ models: [{ name: 'models/gemini-2.5-flash' }, { name: 'models/veo-3.1-fast-generate-preview' }] }));
    const r = await new VeoProvider({ apiKey: 'k', model: 'veo-3.1-fast-generate-preview', fetchImpl: f }).verify();
    expect(r).toMatchObject({ ok: true, models: ['veo-3.1-fast-generate-preview'] });
    expect(calls).toHaveLength(1); expect(calls[0].method).toBe('GET');
    const bad = await new VeoProvider({ apiKey: 'k', model: 'veo-9', fetchImpl: f }).verify();
    expect(bad.ok).toBe(false); expect(bad.message).toMatch(/غير متاح/);
  });
});
