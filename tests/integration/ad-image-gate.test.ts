import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { updateSettings } from '@/lib/settings';
import { generateAdvertisement } from '@/lib/pipeline/generate';
import { setAiProviderOverride } from '@/lib/ai';
import { captureQueues, FakeAiProvider, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });

/** the vision model "reads" garbled text in the first picture only */
class TextInFirstScene extends FakeAiProvider {
  reads = 0;
  constructor(private dirty = 1) { super(); }
  async readText() { this.reads++; return { text: this.reads <= this.dirty ? 'SALE 50% OFF' : 'none', usage: { inputTokens: 300, outputTokens: 20 }, model: 'fake-vision' }; }
}
type Opts = { imageQuality?: { pass: boolean; retried: number; score: number; issues: string[] } };
const qcCheck = async (id: string) => ((await prisma.advertisement.findUniqueOrThrow({ where: { id } })).qcReport as { checks: { id: string; passed: boolean; detail?: string }[] }).checks.find((c) => c.id === 'image_quality');

describe('image quality gate in the ad pipeline', () => {
  it('a scene with text drawn inside is regenerated once with the reason, and the clean one is used', async () => {
    const { accounts } = await seedBase({ imageGate: true });
    const ai = new TextInFirstScene(1); setAiProviderOverride(ai);
    const { advertisement: ad } = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'IMAGE_STORY' });
    expect(ai.sceneCalls).toBe(2);
    expect(ai.lastScenePrompt).toMatch(/ZERO letters/);
    const o = (await prisma.advertisement.findUniqueOrThrow({ where: { id: ad.id } })).options as Opts;
    expect(o.imageQuality).toMatchObject({ pass: true, retried: 1 });
    expect((await qcCheck(ad.id))?.passed).toBe(true);
  });
  it('still failing after the one re-draw: the best attempt is kept and QC warns (no endless spending)', async () => {
    const { accounts } = await seedBase({ imageGate: true });
    const ai = new TextInFirstScene(99); setAiProviderOverride(ai);
    const { advertisement: ad } = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'IMAGE_STORY' });
    expect(ai.sceneCalls).toBe(2);
    const c = await qcCheck(ad.id);
    expect(c?.passed).toBe(false);
    expect(c?.detail).toMatch(/نص داخل الصورة/);
  });
  it('switched off in the AI settings: no vision check, no re-draw', async () => {
    const { accounts } = await seedBase({ imageGate: true });
    await updateSettings((s) => ({ ...s, ai: { ...s.ai, imageQualityGate: false } }));
    const ai = new TextInFirstScene(99); setAiProviderOverride(ai);
    const { advertisement: ad } = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'IMAGE_STORY' });
    expect(ai.sceneCalls).toBe(1); expect(ai.reads).toBe(0);
    expect(await qcCheck(ad.id)).toBeUndefined();
  });
});
