import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { prisma } from '@/lib/db';
import { setSecret, updateSettings } from '@/lib/settings';
import { generateAdvertisement } from '@/lib/pipeline/generate';
import { setAiProviderOverride } from '@/lib/ai';
import type { BriefRequest } from '@/lib/ai/types';
import { captureQueues, FakeAiProvider, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });
afterEach(() => { vi.unstubAllGlobals(); });

/** distinct previews (so the hashes differ) */
const preview = (i: number) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="hsl(${i * 40},60%,50%)"/><rect x="${i * 30}" y="${300 - i * 25}" width="120" height="90" fill="#fff"/><circle cx="${380 - i * 35}" cy="${60 + i * 30}" r="${30 + i * 4}" fill="#111"/></svg>`)).png().toBuffer();

class Researcher extends FakeAiProvider {
  lastInspiration: string | undefined; analysed = 0; fixedScene: Buffer | null = null;
  async generateBrief(req: BriefRequest) { this.lastInspiration = req.inspiration; return super.generateBrief(req); }
  async analyzeReferences(jpegs: Buffer[]) {
    this.analysed = jpegs.length;
    return { principles: { composition: 'low hero angle, one product', colors: 'warm amber and navy', lighting: 'soft window light', productPresentation: 'held in hands', mood: 'cosy', takeaways: ['one clear hero'], avoid: ['busy flat lays'] }, usage: { inputTokens: 1500, outputTokens: 300 }, model: 'fake-vision' };
  }
  async generateScene(prompt: string, opts: Parameters<FakeAiProvider['generateScene']>[1]) {
    if (this.fixedScene) { this.sceneCalls++; return { png: this.fixedScene, model: 'fake-image' }; }
    return super.generateScene(prompt, opts);
  }
}

/** Freepik + its preview CDN, offline: 9 results from 9 authors */
function stubFreepik(previewFor: (i: number) => Promise<Buffer>) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (u: string | URL) => {
    const url = String(u); calls.push(url);
    if (url.startsWith('https://api.freepik.com/v1/resources')) return new Response(JSON.stringify({ data: Array.from({ length: 9 }, (_, i) => ({ id: 100 + i, title: `mug ad ${i}`, url: `https://www.freepik.com/free-photo/mug_${i}.htm`, image: { type: 'photo', source: { url: `https://img.freepik.com/p/${i}.jpg` } }, author: { name: `studio${i}` }, licenses: [{ type: i % 2 ? 'freemium' : 'premium' }] })) }), { status: 200 });
    const m = /img\.freepik\.com\/p\/(\d+)\.jpg/.exec(url);
    if (m) return new Response(new Uint8Array(await previewFor(Number(m[1]))), { status: 200 });
    return new Response('not found', { status: 404 });
  });
  return calls;
}

async function setup() {
  const base = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false, inspiration: { enabled: true, count: 8, freeOnly: false } } }) });
  await setSecret('FREEPIK_API_KEY', 'fp-test-key');
  const ai = new Researcher(); setAiProviderOverride(ai);
  return { base, ai };
}

describe('visual research before every design (Freepik → principles → an original idea)', () => {
  it('8 diverse references are analysed, their principles reach the creative director, every source is logged with its licence', async () => {
    const { base, ai } = await setup();
    const calls = stubFreepik(preview);
    const { advertisement: ad } = await generateAdvertisement({ accountId: base.accounts[0].id, createdBy: 't', format: 'IMAGE_FEED' });
    expect(calls.filter((c) => c.includes('api.freepik.com'))).toHaveLength(1);
    expect(ai.analysed).toBe(8);
    expect(ai.lastInspiration).toMatch(/8 Freepik references were analysed/);
    expect(ai.lastInspiration).toMatch(/never copy any reference/);
    const ins = ((await prisma.advertisement.findUniqueOrThrow({ where: { id: ad.id } })).options as { inspiration?: { sources: { url: string; license: string; author: string }[]; principles: { composition: string } } }).inspiration!;
    expect(ins.sources).toHaveLength(8);
    expect(new Set(ins.sources.map((s) => s.author)).size).toBe(8);
    expect(ins.sources.every((s) => s.url.startsWith('https://www.freepik.com/') && ['freemium', 'premium'].includes(s.license))).toBe(true);
    expect(ins.principles.composition).toMatch(/hero angle/);
    // the reference images were never handed to the image model
    expect(ai.lastReferences ?? []).not.toContain(await preview(0));
    const qc = (await prisma.advertisement.findUniqueOrThrow({ where: { id: ad.id } })).qcReport as { checks: { id: string; passed: boolean }[] };
    expect(qc.checks.find((c) => c.id === 'inspiration_original')?.passed).toBe(true);
  });

  it('a design that copies a reference is BLOCKED by the originality check', async () => {
    const { base, ai } = await setup();
    const copy = await sharp(await preview(3)).resize(1024, 1536, { fit: 'fill' }).png().toBuffer();
    ai.fixedScene = copy; // the image model «returns» one of the references
    stubFreepik(preview);
    const { advertisement: ad } = await generateAdvertisement({ accountId: base.accounts[0].id, createdBy: 't', format: 'IMAGE_FEED' });
    const qc = (await prisma.advertisement.findUniqueOrThrow({ where: { id: ad.id } })).qcReport as { passed: boolean; checks: { id: string; passed: boolean; detail?: string }[] };
    const c = qc.checks.find((x) => x.id === 'inspiration_original')!;
    expect(c.passed).toBe(false);
    expect(c.detail).toMatch(/أقرب مرجع 103/);
    expect(qc.passed).toBe(false);
  });

  it('switched off or no key → no research, the design is made exactly as before', async () => {
    const { base, ai } = await setup();
    await updateSettings((s) => ({ ...s, ai: { ...s.ai, inspiration: { ...s.ai.inspiration, enabled: false } } }));
    const calls = stubFreepik(preview);
    await generateAdvertisement({ accountId: base.accounts[0].id, createdBy: 't', format: 'IMAGE_FEED' });
    expect(calls.filter((c) => c.includes('freepik'))).toHaveLength(0);
    expect(ai.lastInspiration).toBeUndefined();
  });

  it('a Freepik failure never blocks the design — the owner is told', async () => {
    const { base, ai } = await setup();
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 401 }));
    const { advertisement: ad } = await generateAdvertisement({ accountId: base.accounts[0].id, createdBy: 't', format: 'IMAGE_FEED' });
    expect(ad.state).not.toBe('FAILED');
    expect(ai.lastInspiration).toBeUndefined();
    expect(await prisma.notification.count({ where: { code: 'INSPIRATION_FAILED' } })).toBe(1);
  });
});
