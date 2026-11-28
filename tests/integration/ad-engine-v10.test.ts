import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { updateSettings } from '@/lib/settings';
import { generateAdvertisement } from '@/lib/pipeline/generate';
import { setAiProviderOverride } from '@/lib/ai';
import { captureQueues, FakeAiProvider, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });
type Qc = { checks: { id: string; passed: boolean; detail?: string }[]; requiresHuman?: boolean };
type Opts = { adScore?: { total: number; history: number[]; passed: boolean }; direction?: { renderMode?: string } };

/**
 * the art director scores each version in turn. The sequences keep their old meaning (the FINAL total minus 30): the
 * playbook rubric measures 10 points instead of 30, so the judged points are the old figure + 20, spread over the seven
 * judged criteria within their caps (originality 20 · aesthetics 15 · attention 15 · composition · harmony · marketing · clarity 10).
 */
class Scored extends FakeAiProvider {
  scores: number[]; scoreCalls = 0;
  constructor(judgedSeq: number[]) { super(); this.scores = judgedSeq; }
  async scoreAd() {
    let left = this.scores[Math.min(this.scoreCalls++, this.scores.length - 1)] + 20;
    const caps: [string, number][] = [['originality', 20], ['aesthetics', 15], ['attention', 15], ['composition', 10], ['harmony', 10], ['marketing', 10], ['clarity', 10]];
    const judged: Record<string, number> = {};
    for (const [k, cap] of caps) { judged[k] = Math.max(0, Math.min(cap, left)); left -= judged[k]; }
    return { judged, reasons: { originality: 'لقطة قوية' }, weakness: 'product too small', fix: 'make the mug larger and the light warmer', usage: { inputTokens: 900, outputTokens: 80 }, model: 'fake-vision' };
  }
}

describe('V10 ad engine in the pipeline (golden rule + 100-point rubric)', () => {
  it('automatic mode = HYBRID: a text-free design, the headline and badge typed by the system, no human needed for spelling', async () => {
    const { accounts } = await seedBase({ autoRenderMode: 'auto' });
    const ai = new Scored([70]); setAiProviderOverride(ai);
    const { advertisement: ad } = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'IMAGE_STORY', direction: { renderMode: 'auto' } });
    const row = await prisma.advertisement.findUniqueOrThrow({ where: { id: ad.id } });
    expect((row.options as Opts).direction?.renderMode).toBe('hybrid');
    expect(ai.lastScenePrompt).toMatch(/TEXT-FREE DESIGN/);
    expect(ai.lastScenePrompt).not.toMatch(/kicker line|huge bold headline|labels under each/);
    const m = (row as unknown as { qcReport: Qc }).qcReport;
    expect(m.requiresHuman).toBeFalsy(); // the text is the system's own, verified
    expect(m.checks.find((c) => c.id === 'ad_score')).toMatchObject({ passed: true });
  });

  it('below 95 the design is re-drawn with the art director\'s note, and the best version is kept', async () => {
    const { accounts } = await seedBase({ autoRenderMode: 'auto' });
    const ai = new Scored([45, 70]); setAiProviderOverride(ai);
    const before = ai.sceneCalls;
    const { advertisement: ad } = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'IMAGE_FEED', direction: { renderMode: 'hybrid' } });
    const o = (await prisma.advertisement.findUniqueOrThrow({ where: { id: ad.id } })).options as Opts;
    expect(o.adScore?.passed).toBe(true);
    expect(o.adScore?.history).toHaveLength(2);
    expect(o.adScore!.history[0]).toBeLessThan(95); expect(o.adScore!.total).toBe(o.adScore!.history[1]);
    expect(ai.sceneCalls - before).toBe(2);
    expect(ai.lastScenePrompt).toMatch(/ART DIRECTOR NOTE \(version 2\): the previous version scored \d+\/100\. Biggest problem: product too small/);
  });

  it('never reaching the bar within the re-draw limit: kept for the owner\'s approval, not publishable automatically', async () => {
    const { accounts } = await seedBase({ autoRenderMode: 'auto' });
    await updateSettings((s) => ({ ...s, ai: { ...s.ai, adScore: { enabled: true, threshold: 95, maxRedraws: 1 } } }));
    const ai = new Scored([30, 42]); setAiProviderOverride(ai);
    const { advertisement: ad } = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'IMAGE_SQUARE', direction: { renderMode: 'hybrid' } });
    const row = await prisma.advertisement.findUniqueOrThrow({ where: { id: ad.id } });
    const sc = (row.options as Opts).adScore!;
    expect(sc.passed).toBe(false); expect(sc.history).toHaveLength(2); expect(sc.total).toBe(Math.max(...sc.history));
    const c = ((row as unknown as { qcReport: Qc }).qcReport).checks.find((x) => x.id === 'ad_score')!;
    expect(c.passed).toBe(false);
    expect(c.detail).toMatch(/\d+\/100 · أفضل 2 نسخ — product too small/);
    expect(['GENERATED', 'QUALITY_REVIEW']).toContain(row.state); // waits for a human
  });
});
