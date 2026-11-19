import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { updateSettings } from '@/lib/settings';
import { generateAdvertisement } from '@/lib/pipeline/generate';
import { setAiProviderOverride } from '@/lib/ai';
import { captureQueues, FakeAiProvider, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });

/** the "model" reports the headline's last word as misspelled (adds a letter) */
class ProofreadingAi extends FakeAiProvider {
  proofCalls = 0;
  async generateJson(_system: string, user: string) {
    this.proofCalls++;
    const copy = JSON.parse(user) as { headline: string };
    const w = copy.headline.trim().split(/\s+/).pop()!;
    return { json: { issues: [{ field: 'headline', wrong: w, fix: `${w}ة`, reason: 'اختبار' }] }, usage: { inputTokens: 500, outputTokens: 60 }, model: 'fake-text' };
  }
}

describe('AI proofreading in the pipeline', () => {
  it('off by default: no extra AI call', async () => {
    const { accounts } = await seedBase();
    const ai = new ProofreadingAi(); setAiProviderOverride(ai);
    await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't' });
    expect(ai.proofCalls).toBe(0);
  });
  it('on: the fix is applied BEFORE the design is drawn, recorded, and shown in QC', async () => {
    const { accounts } = await seedBase();
    await updateSettings((s) => ({ ...s, ai: { ...s.ai, useAiReview: true } }));
    const ai = new ProofreadingAi(); setAiProviderOverride(ai);
    const { advertisement: ad } = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't' });
    expect(ai.proofCalls).toBe(1);
    const row = await prisma.advertisement.findUniqueOrThrow({ where: { id: ad.id } });
    const o = row.options as { aiProofread?: { applied: { fix: string }[] } };
    expect(o.aiProofread?.applied).toHaveLength(1);
    expect(row.headline).toContain(o.aiProofread!.applied[0].fix);
    const qc = row.qcReport as { checks: { id: string; detail?: string }[] };
    expect(qc.checks.find((c) => c.id === 'ai_proofread')?.detail).toMatch(/صُحّح/);
    expect(await prisma.aiUsage.count({ where: { inputTokens: 500 } })).toBe(1);
  });
});
