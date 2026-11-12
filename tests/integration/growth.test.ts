import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { updateSettings } from '@/lib/settings';
import { runSchedulerCycle } from '@/lib/scheduler/cycle';
import { generateAdvertisement } from '@/lib/pipeline/generate';
import { setAiProviderOverride } from '@/lib/ai';
import { peakHoursFor, shouldWaitForPeak } from '@/lib/growth/peak-hours';
import { boostWinners, findWinners } from '@/lib/growth/winners';
import { captured, captureQueues, FakeAiProvider, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });

/** a verified publication at a given Bahrain hour with real-looking metrics */
async function measured(accountId: string, hourBh: number, reach: number, extra: { saves?: number; shares?: number } = {}, daysAgo = 2) {
  const ad = (await generateAdvertisement({ accountId, createdBy: 't', format: 'IMAGE_FEED' })).advertisement;
  await prisma.advertisement.update({ where: { id: ad.id }, data: { state: 'PUBLISHED', createdAt: new Date(Date.now() - 5 * 86400_000) } });
  const at = new Date(Date.now() - daysAgo * 86400_000); at.setUTCHours(hourBh - 3, 0, 0, 0);
  const job = await prisma.publicationJob.create({ data: { idempotencyKey: `k-${ad.id}`, advertisementId: ad.id, accountId, provider: 'metricool', state: 'PUBLISHED', scheduledFor: at } });
  await prisma.publicationResult.create({ data: { jobId: job.id, verifiedAt: at, metricsFetchedAt: new Date(), metrics: { reach, likes: 5, saves: extra.saves ?? 0, shares: extra.shares ?? 0 } } });
  return ad;
}
async function setup() {
  const r = await seedBase({ productCount: 30, settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false, maxDailyAds: 500 } }) });
  await prisma.socialAccount.updateMany({ data: { maxDailyAds: 100 } });
  setAiProviderOverride(new FakeAiProvider());
  return r.accounts;
}

describe('peak hours', () => {
  it('uses the Metricool brand ranking until there is enough data, then learns from real reach', async () => {
    const [a] = await setup();
    expect(await peakHoursFor(a, 4)).toMatchObject({ source: 'default', hours: [10, 11, 12, 18] });
    for (const [h, reach] of [[20, 900], [20, 1000], [21, 800], [21, 850], [9, 100], [9, 120], [14, 300], [14, 280], [16, 200], [16, 210], [13, 150], [13, 160]] as const) await measured(a.id, h, reach);
    const p = await peakHoursFor(a, 3);
    expect(p).toMatchObject({ source: 'data', sample: 12 });
    expect(p.hours).toEqual([20, 21, 14]);
  });
  it('waits for a near peak inside the window, never past it', () => {
    const w = { publishWindowStart: '08:00', publishWindowEnd: '22:00', timezone: 'Asia/Bahrain' };
    const at = (h: number) => new Date(`2026-11-09T${String(h - 3).padStart(2, '0')}:00:00Z`);
    expect(shouldWaitForPeak(at(15), [10, 18], w, 3)).toBe(true); // 18:00 is 3 h away
    expect(shouldWaitForPeak(at(14), [10, 18], w, 3)).toBe(false); // 4 h away → post now
    expect(shouldWaitForPeak(at(18), [10, 18], w, 3)).toBe(false); // already a peak
    expect(shouldWaitForPeak(at(20), [23], w, 3)).toBe(false); // the peak is outside the window
  });
  it('scheduler: a due account waits for the peak (WAITING_PEAK) without losing its turn', async () => {
    const { accounts } = await seedBase();
    await prisma.socialAccount.updateMany({ data: { autoPublishEnabled: true, publishWindowStart: '08:00', publishWindowEnd: '22:00' } });
    await updateSettings((s) => ({ ...s, autoPublishGlobal: true, growth: { ...s.growth, peakHours: { enabled: true, maxDelayHours: 3, count: 4 } } }));
    const r = await runSchedulerCycle(new Date('2026-11-09T11:10:00Z')); // 14:10 Bahrain → 15:00 slot; default peak 18 is 3 h away
    expect(r.ineligible[accounts[0].id]).toBe('WAITING_PEAK');
    expect(captured.generate).toHaveLength(0);
    const r2 = await runSchedulerCycle(new Date('2026-11-09T14:10:00Z')); // → 18:00 slot (peak)
    expect(r2.planned).toHaveLength(2);
  });
});

describe('winners boost', () => {
  it('finds posts far above the account median and queues ONE reel follow-up each, respecting the weekly cap', async () => {
    const [a] = await setup();
    const ads = [];
    for (const reach of [100, 120, 110, 90, 105, 600, 450]) ads.push(await measured(a.id, 10, reach));
    const w = await findWinners(2);
    expect(w.map((x) => x.reach)).toEqual([600, 450]);
    expect(w[0]).toMatchObject({ medianReach: 110, multiple: 5.5 });
    expect(await boostWinners()).toMatchObject({ boosted: [], reason: 'disabled' });
    await updateSettings((s) => ({ ...s, growth: { ...s.growth, winners: { enabled: true, minMultiple: 2, maxPerWeek: 1 } } }));
    const r = await boostWinners();
    expect(r.boosted).toEqual([ads[5].id]);
    const job = captured.generate[0].data as { format: string; productId: string; createdBy: string; direction: { idea: string } };
    expect(job).toMatchObject({ format: 'REEL_VIDEO', productId: ads[5].productId, createdBy: 'winners' });
    expect(job.direction.idea).toMatch(/بزاوية جديدة/);
    expect((await boostWinners()).boosted).toEqual([]); // weekly cap 1
    await updateSettings((s) => ({ ...s, growth: { ...s.growth, winners: { enabled: true, minMultiple: 2, maxPerWeek: 5 } } }));
    expect((await boostWinners()).boosted).toEqual([ads[6].id]); // the first winner is never boosted twice
  });
  it('needs at least 5 measured posts per account', async () => {
    const [a] = await setup();
    for (const reach of [100, 900]) await measured(a.id, 10, reach);
    expect(await findWinners(2)).toEqual([]);
  });
});
