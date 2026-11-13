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
    expect(referencePrompt([{ role: 'product' }, { role: 'style' }])).toMatch(/Reference image 1 is a REAL PHOTO[\s\S]*Reference image 2 is a REFERENCE DESIGN[\s\S]*do NOT copy its texts/);
    expect(referencePrompt([])).toBe('');
  });

  it('sends the product photo + reference design to the image model and records it on the ad', async () => {
    const { accounts } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false } }) });
    const product = await prisma.product.findFirstOrThrow({ where: { active: true } });
    await prisma.product.update({ where: { id: product.id }, data: { photoKey: await saveReference('product', product.id, await photo()) } });
    const styleKey = await saveReference('style', 'design', await photo(1024, 1536));
    await updateSettings((s) => ({ ...s, ai: { ...s.ai, styleReferenceKey: styleKey } }));
    const p = new FakeAiProvider(); setAiProviderOverride(p);
    const r = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', productId: product.id, format: 'IMAGE_STORY', direction: { renderMode: 'ai_full' } });
    expect(p.lastReferences).toHaveLength(2);
    expect(p.lastScenePrompt).toMatch(/REAL PHOTO of the product[\s\S]*REFERENCE DESIGN/);
    const ad = await prisma.advertisement.findUniqueOrThrow({ where: { id: r.advertisement.id } });
    expect((ad.options as { references?: string[] }).references).toEqual(['product', 'style']);

    // layered mode: only the product photo (the reference design is for full-AI posters)
    const r2 = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', productId: product.id, format: 'IMAGE_STORY', direction: { renderMode: 'layered' } });
    expect(p.lastReferences).toHaveLength(1);
    expect(r2.advertisement.id).not.toBe(r.advertisement.id);

    // owner can switch references off
    await updateSettings((s) => ({ ...s, ai: { ...s.ai, useReferences: false } }));
    await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', productId: product.id, format: 'IMAGE_STORY', direction: { renderMode: 'ai_full' } });
    expect(p.lastReferences).toBeUndefined();
  });
});
