import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { updateSettings } from '@/lib/settings';
import { generateAdvertisement } from '@/lib/pipeline/generate';
import { setAiProviderOverride } from '@/lib/ai';
import { captureQueues, FakeAiProvider, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });
type Qc = { checks: { id: string; passed: boolean; detail?: string }[]; requiresHuman?: boolean };
type Opts = { adScore?: { total: number; history: number[]; passed: boolean }; direction?: { renderMode?: string } };

/** the art director scores each version in turn (a scripted sequence) */
class Scored extends FakeAiProvider {
  scores: number[]; scoreCalls = 0;
  constructor(seq: number[]) { super(); this.scores = seq; }
  async scoreAd() {
    const t = this.scores[Math.min(this.scoreCalls++, this.scores.length - 1)] - 20; // + 20 measured points (logo + text)
    const judged = { attention: Math.round(t * 0.25), creativity: Math.round(t * 0.25), image: Math.round(t * 0.1875), clarity: Math.round(t * 0.1875), share: 0 };
    judged.share = Math.max(0, t - judged.attention - judged.creativity - judged.image - judged.clarity);
    return { judged, weakness: 'product too small', fix: 'make the mug larger and the light warmer', usage: { inputTokens: 900, outputTokens: 80 }, model: 'fake-vision' };
  }
}

describe('V10 ad engine in the pipeline (golden rule + 100-point rubric)', () => {
  it('automatic mode = HYBRID: a text-free design, the headline and badge typed by the system, no human needed for spelling', async () => {
    const { accounts } = await seedBase({ autoRenderMode: 'auto' });
    const ai = new Scored([97]); setAiProviderOverride(ai);
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
    const ai = new Scored([80, 96]); setAiProviderOverride(ai);
    const before = ai.sceneCalls;
    const { advertisement: ad } = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'IMAGE_FEED', direction: { renderMode: 'hybrid' } });
    const o = (await prisma.advertisement.findUniqueOrThrow({ where: { id: ad.id } })).options as Opts;
    expect(o.adScore).toMatchObject({ total: 96, passed: true, history: [80, 96] });
    expect(ai.sceneCalls - before).toBe(2);
    expect(ai.lastScenePrompt).toMatch(/ART DIRECTOR NOTE \(version 2\): the previous version scored 80\/100\. Biggest problem: product too small/);
  });

  it('never reaching the bar within the re-draw limit: kept for the owner\'s approval, not publishable automatically', async () => {
    const { accounts } = await seedBase({ autoRenderMode: 'auto' });
    await updateSettings((s) => ({ ...s, ai: { ...s.ai, adScore: { enabled: true, threshold: 95, maxRedraws: 1 } } }));
    const ai = new Scored([70, 82]); setAiProviderOverride(ai);
    const { advertisement: ad } = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'IMAGE_SQUARE', direction: { renderMode: 'hybrid' } });
    const row = await prisma.advertisement.findUniqueOrThrow({ where: { id: ad.id } });
    expect((row.options as Opts).adScore).toMatchObject({ total: 82, passed: false, history: [70, 82] });
    const c = ((row as unknown as { qcReport: Qc }).qcReport).checks.find((x) => x.id === 'ad_score')!;
    expect(c.passed).toBe(false);
    expect(c.detail).toMatch(/82\/100 · أفضل 2 نسخ — product too small/);
    expect(['GENERATED', 'QUALITY_REVIEW']).toContain(row.state); // waits for a human
  });
});
