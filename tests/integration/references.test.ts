import { beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { prisma } from '@/lib/db';
import { updateSettings } from '@/lib/settings';
import { generateAdvertisement } from '@/lib/pipeline/generate';
import { setAiProviderOverride } from '@/lib/ai';
import { normaliseReference, saveReference, referencePrompt } from '@/lib/creative/references';
import { captureQueues, FakeAiProvider, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });
const photo = (w = 1200, h = 900) => sharp({ create: { width: w, height: h, channels: 3, background: '#f4f1ea' } }).jpeg().toBuffer();

describe('reference images (real product photo + reference design)', () => {
  it('normalises uploads and rejects non-images and tiny images', async () => {
    const png = await normaliseReference(await photo(3000, 2000));
    const m = await sharp(png).metadata();
    expect([m.format, m.width, m.height]).toEqual(['png', 1536, 1024]);
    await expect(normaliseReference(Buffer.from('not an image'))).rejects.toThrow(/ليس صورة/);
    await expect(normaliseReference(await photo(100, 100))).rejects.toThrow(/صغيرة/);
    expect(referencePrompt([{ role: 'product' }], 'navy and gold')).toMatch(/Reference image 1 is a REAL PHOTO[\s\S]*TARGET DESIGN STYLE[\s\S]*navy and gold/);
    expect(referencePrompt([])).toBe('');
    expect(referencePrompt([{ role: 'style' }], 'warm sunset', 'scene')).toMatch(/STYLE REFERENCE[\s\S]*Do NOT copy its product[\s\S]*TARGET PHOTO LOOK[\s\S]*warm sunset/);
  });

  it('sends the product photo and the reference design (style only) in every mode; each can be switched off', async () => {
    const { accounts } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false } }) });
    const product = await prisma.product.findFirstOrThrow({ where: { active: true } });
    await prisma.product.update({ where: { id: product.id }, data: { photoKey: await saveReference('product', product.id, await photo()) } });
    const styleKey = await saveReference('style', 'design', await photo(1024, 1536));
    await updateSettings((s) => ({ ...s, ai: { ...s.ai, styleReferenceKey: styleKey } }));
    const p = new FakeAiProvider(); setAiProviderOverride(p);
    const r = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', productId: product.id, format: 'IMAGE_STORY', direction: { renderMode: 'ai_full' } });
    expect(p.lastReferences).toHaveLength(2); // the product photo + the reference design as a STYLE reference
    expect(p.lastScenePrompt).toMatch(/Reference image 1 is a REAL PHOTO of the product[\s\S]*Reference image 2 is the owner's STYLE REFERENCE[\s\S]*Do NOT copy[\s\S]*TARGET DESIGN STYLE[\s\S]*glossy gold/);
    expect((await import('@/lib/settings').then((m) => m.getSettings())).ai.styleReferenceBrief).toMatch(/glossy gold/); // described once, cached
    const ad = await prisma.advertisement.findUniqueOrThrow({ where: { id: r.advertisement.id } });
    expect((ad.options as { references?: string[] }).references).toEqual(['product', 'style']);

    // layered mode (gold poster): the reference's PHOTO LOOK applies too (it used to be ignored), not its typography/layout
    const r2 = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', productId: product.id, format: 'IMAGE_STORY', direction: { renderMode: 'layered' } });
    expect(p.lastReferences).toHaveLength(2);
    expect(p.lastScenePrompt).toMatch(/TARGET PHOTO LOOK[\s\S]*glossy gold/);
    expect(p.lastScenePrompt).not.toMatch(/TARGET DESIGN STYLE/);
    expect(r2.advertisement.id).not.toBe(r.advertisement.id);

    // the image itself can be switched off: the written style still applies
    await updateSettings((s) => ({ ...s, ai: { ...s.ai, styleRefImage: false } }));
    await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', productId: product.id, format: 'IMAGE_STORY', direction: { renderMode: 'layered' } });
    expect(p.lastReferences).toHaveLength(1);
    expect(p.lastScenePrompt).toMatch(/TARGET PHOTO LOOK/);

    // owner can switch references off
    await updateSettings((s) => ({ ...s, ai: { ...s.ai, useReferences: false } }));
    await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', productId: product.id, format: 'IMAGE_STORY', direction: { renderMode: 'ai_full' } });
    expect(p.lastReferences).toBeUndefined();
  });
});

describe('reference design per format', () => {
  it('each format uses its own reference style; carousel falls back to feed, then the general one', async () => {
    const { slotsFor } = await import('@/lib/creative/references');
    expect(slotsFor('REEL_VIDEO')).toEqual(['vertical']);
    expect(slotsFor('IMAGE_CAROUSEL')).toEqual(['carousel', 'feed']);
    const { accounts } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false } }) });
    await updateSettings((s) => ({ ...s, ai: { ...s.ai, styleReferenceKey: 'k-general', styleReferenceBrief: 'GENERAL-STYLE', styleRefsByFormat: {
      vertical: { key: 'k-v', brief: 'VERTICAL-STYLE' }, feed: { key: 'k-f', brief: 'FEED-STYLE' },
    } } }));
    const p = new FakeAiProvider(); setAiProviderOverride(p);
    const run = async (format: 'IMAGE_STORY' | 'IMAGE_FEED' | 'IMAGE_CAROUSEL' | 'IMAGE_SQUARE') => { await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format, direction: { renderMode: 'ai_full' } }); return p.lastScenePrompt; };
    expect(await run('IMAGE_STORY')).toContain('VERTICAL-STYLE');
    expect(await run('IMAGE_FEED')).toContain('FEED-STYLE');
    expect(await run('IMAGE_CAROUSEL')).toContain('FEED-STYLE'); // no carousel reference → feed
    const sq = await run('IMAGE_SQUARE');
    expect(sq).toContain('GENERAL-STYLE'); // no square reference → general
    expect(sq).not.toMatch(/VERTICAL-STYLE|FEED-STYLE/);
  });
});
