import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { generateAdvertisement } from '@/lib/pipeline/generate';
import { setAiProviderOverride } from '@/lib/ai';
import { captureQueues, FakeAiProvider, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });
type Qc = { publishable: boolean; checks: { id: string; passed: boolean; detail?: string; severity: string }[] };

/** the vision inspector reports a product inside the headline area for the first N images */
class Inspected extends FakeAiProvider {
  inspections = 0;
  constructor(private bad = 1) { super(); }
  async inspectPoster(_png: Buffer, _m: string, zones: { bottomPct: number; productHint: string; topPct?: number }) {
    this.inspections++;
    const clear = this.inspections > this.bad;
    return { text: '', layout: { productVisible: true, bottomClear: true, ...(zones.topPct ? { topClear: clear } : {}), issues: clear ? [] : ['mug top inside the headline area'] }, usage: { inputTokens: 900, outputTokens: 60 }, model: 'fake-vision' };
  }
}
const qc = async (id: string) => (await prisma.advertisement.findUniqueOrThrow({ where: { id } }) as unknown as { qcReport: Qc }).qcReport;

describe('hybrid: the AI picture never invades the system layers', () => {
  it('no layer overlap in a real pipeline design: no QC blocker from the layout', async () => {
    const { accounts } = await seedBase();
    setAiProviderOverride(new FakeAiProvider());
    for (const format of ['IMAGE_STORY', 'IMAGE_FEED', 'IMAGE_SQUARE'] as const) {
      const { advertisement: ad } = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format, direction: { renderMode: 'hybrid' } });
      const r = await qc(ad.id);
      const blockers = r.checks.filter((c) => !c.passed && c.severity === 'BLOCKER' && c.id !== 'real_ai_media').map((c) => `${c.id}: ${c.detail}`);
      expect(blockers, format).toEqual([]);
      expect(r.checks.find((c) => c.id === 'no_overlap')?.passed, format).toBe(true);
    }
  });

  it('a product drawn into the headline area → one corrective re-draw with the exact zones; the clean version is used', async () => {
    const { accounts } = await seedBase();
    const ai = new Inspected(1); setAiProviderOverride(ai);
    const { advertisement: ad } = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'IMAGE_STORY', direction: { renderMode: 'hybrid' } });
    expect(ai.inspections).toBe(2);
    expect(ai.lastScenePrompt).toMatch(/LAYOUT CORRECTION: the previous image had these problems: objects or highlights inside the top \d+% headline area/);
    expect((await qc(ad.id)).checks.find((c) => c.id === 'ai_layout')).toMatchObject({ passed: true });
  });

  it('still invading after the re-draw: kept, and QC flags it for the owner (not silently published)', async () => {
    const { accounts } = await seedBase();
    setAiProviderOverride(new Inspected(99));
    const { advertisement: ad } = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'IMAGE_FEED', direction: { renderMode: 'hybrid' } });
    const c = (await qc(ad.id)).checks.find((x) => x.id === 'ai_layout')!;
    expect(c.passed).toBe(false);
    expect(c.detail).toMatch(/headline area/);
  });
});
