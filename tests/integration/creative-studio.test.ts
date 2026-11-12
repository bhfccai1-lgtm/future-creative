import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { updateSettings } from '@/lib/settings';
import { generateAdvertisement, pickArt } from '@/lib/pipeline/generate';
import { setAiProviderOverride } from '@/lib/ai';
import { CONCEPTS } from '@/lib/creative/options';
import { scenePrompt } from '@/lib/ai/prompts';
import { captureQueues, FakeAiProvider, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });

class JudgingProvider extends FakeAiProvider {
  judged = 0;
  async judgeImages(images: Buffer[]) { this.judged++; return { best: images.length - 1, scores: images.map((_, i) => 50 + i * 10), reason: 'sharper product', usage: { inputTokens: 900, outputTokens: 40 }, model: 'fake-vision' }; }
}

describe('creative concepts', () => {
  it('rotate per account, never repeat back-to-back; formal accounts only get formal ideas; macro and «none» stay classic', async () => {
    const { accounts } = await seedBase({ productCount: 20, settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false, maxDailyAds: 100 } }) });
    setAiProviderOverride(new FakeAiProvider());
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'IMAGE_FEED' });
      const art = ((await prisma.advertisement.findUniqueOrThrow({ where: { id: r.advertisement.id } })).options as { direction: { art: { concept?: string } } }).direction.art;
      if (art.concept) seen.push(art.concept);
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBeGreaterThanOrEqual(3);
    const formal = await pickArt(accounts[1].id, { aiFull: false, concepts: true, formal: true });
    expect(CONCEPTS.find((c) => c.value === formal.concept)?.formal).toBe(true);
    expect((await pickArt(accounts[1].id, { aiFull: false, concepts: true, composition: 'macro_detail' })).concept).toBeUndefined();
    expect((await pickArt(accounts[1].id, { aiFull: false, concepts: true, concept: 'none' })).concept).toBeUndefined();
    expect((await pickArt(accounts[1].id, { aiFull: false, concepts: false })).concept).toBeUndefined();
    expect((await pickArt(accounts[1].id, { aiFull: false, concepts: false, concept: 'paper_craft' })).concept).toBe('paper_craft');
    expect(scenePrompt('a mug', 'style', { concept: 'X-IDEA' })).toMatch(/Creative concept.*X-IDEA/);
  });
});

describe('art director (best of N)', () => {
  it('generates N candidates, keeps the judged best and records why', async () => {
    const { accounts } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false } }) });
    const p = new JudgingProvider(); setAiProviderOverride(p);
    await updateSettings((s) => ({ ...s, ai: { ...s.ai, bestOf: 2 } }));
    const r = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'IMAGE_FEED' });
    expect(p.sceneCalls).toBe(2);
    expect(p.judged).toBe(1);
    const ad = await prisma.advertisement.findUniqueOrThrow({ where: { id: r.advertisement.id } });
    expect((ad.options as { artDirector: unknown }).artDirector).toMatchObject({ candidates: 2, best: 1, scores: [50, 60], reason: 'sharper product' });
    expect(ad.state).toBe('QUALITY_REVIEW');
  });
  it('bestOf 1 (default) → a single image, no judging', async () => {
    const { accounts } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false } }) });
    const p = new JudgingProvider(); setAiProviderOverride(p);
    await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'IMAGE_FEED' });
    expect(p.sceneCalls).toBe(1);
    expect(p.judged).toBe(0);
  });
});
