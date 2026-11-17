import sharp from 'sharp';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { generateAdvertisement } from '@/lib/pipeline/generate';
import { setAiProviderOverride } from '@/lib/ai';
import { saveReference } from '@/lib/creative/references';
import { storage } from '@/lib/storage';
import { captureQueues, FakeAiProvider, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });

describe('«أعمال منجزة» — real photo posts', () => {
  it('uses the owner photo as the scene: no AI image job, verified text layers, real_work angle', async () => {
    const { accounts } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false } }) });
    setAiProviderOverride(new FakeAiProvider());
    const photo = await sharp({ create: { width: 1200, height: 900, channels: 3, background: { r: 200, g: 30, b: 30 } } }).jpeg().toBuffer();
    const key = await saveReference('work', 'job-1', photo);
    const r = await generateAdvertisement({ accountId: accounts[0].id, format: 'IMAGE_FEED', createdBy: 'tester', direction: { realPhotoKey: key, idea: 'أعمال منجزة: 200 كوب لفعالية', renderMode: 'ai_full' } });
    expect(r.advertisement.state).toBe('QUALITY_REVIEW');
    const opts = r.advertisement.options as { direction: { contentType: string; renderMode: string } };
    expect(opts.direction).toMatchObject({ contentType: 'real_work', renderMode: 'layered' });
    expect(await prisma.aiGenerationJob.count({ where: { advertisementId: r.advertisement.id, kind: 'IMAGE' } })).toBe(0);
    const scene = await prisma.mediaAsset.findFirstOrThrow({ where: { advertisementId: r.advertisement.id, role: 'SCENE' } });
    const { data } = await sharp(await storage().get(scene.storageKey)).resize(1, 1).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(150); expect(data[1]).toBeLessThan(80); // the real (red) photo, not an AI scene
    expect(await prisma.mediaAsset.count({ where: { advertisementId: r.advertisement.id, role: 'FINAL' } })).toBe(1);
  });
});
