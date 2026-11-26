import { beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { prisma } from '@/lib/db';
import { updateSettings } from '@/lib/settings';
import { generateAdvertisement } from '@/lib/pipeline/generate';
import { setAiProviderOverride } from '@/lib/ai';
import { storage } from '@/lib/storage';
import { captureQueues, FakeAiProvider, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });
type Opts = { photo?: { recipe: string | null; finish: string[] }; direction?: { art?: { lens?: string } } };

describe('photo studio in the ad pipeline: the product decides the shot, a measured retouch finishes it', () => {
  it('a mug is shot like a mug: its recipe is in the prompt, never a top-down lens, and the retouch is recorded', async () => {
    const { accounts } = await seedBase({ productCount: 20 });
    const mug = await prisma.product.findFirstOrThrow({ where: { slug: 'ceramic-mugs' } });
    const ai = new FakeAiProvider(); setAiProviderOverride(ai);
    for (let i = 0; i < 3; i++) { // the lens rotation over several designs stays inside the mug's recipe
      const { advertisement: ad } = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'IMAGE_STORY', productId: mug.id });
      const o = (await prisma.advertisement.findUniqueOrThrow({ where: { id: ad.id } })).options as Opts;
      expect(['85mm', '50mm', 'low_hero']).toContain(o.direction?.art?.lens);
      expect(o.photo).toMatchObject({ recipe: 'drinkware' });
      expect(o.photo!.finish).toContain('clarity');
    }
    expect(ai.lastScenePrompt).toMatch(/Camera \(shot by a specialist product photographer\): eye-level three-quarter view/);
    expect(ai.lastScenePrompt).toMatch(/Material truth: glossy ceramic glaze/);
  });

  it('switched off: no recipe lines, no retouch — the picture is exactly what the model drew', async () => {
    const { accounts } = await seedBase({ productCount: 20 });
    await updateSettings((s) => ({ ...s, ai: { ...s.ai, shotRecipes: false, photoFinish: false } }));
    const ai = new FakeAiProvider(); setAiProviderOverride(ai);
    const { advertisement: ad } = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'IMAGE_STORY' });
    expect(ai.lastScenePrompt).not.toMatch(/Material truth:/);
    const o = (await prisma.advertisement.findUniqueOrThrow({ where: { id: ad.id } })).options as Opts;
    expect(o.photo).toBeUndefined();
    const a = await prisma.mediaAsset.findFirst({ where: { advertisementId: ad.id } });
    if (a) expect((await sharp(await storage().get(a.storageKey)).metadata()).width).toBeGreaterThan(0);
  });
});
