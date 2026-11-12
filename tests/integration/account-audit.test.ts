import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { generateAdvertisement } from '@/lib/pipeline/generate';
import { setAiProviderOverride } from '@/lib/ai';
import { auditAccounts } from '@/lib/ops/account-audit';
import { captureQueues, FakeAiProvider, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });

async function published(accountId: string, format: 'IMAGE_FEED' | 'REEL_VIDEO' | 'IMAGE_STORY', reach: number | null) {
  const ad = (await generateAdvertisement({ accountId, createdBy: 't', format })).advertisement;
  await prisma.advertisement.update({ where: { id: ad.id }, data: { state: 'PUBLISHED', createdAt: new Date(Date.now() - 5 * 86400_000) } });
  const job = await prisma.publicationJob.create({ data: { idempotencyKey: `k-${ad.id}`, advertisementId: ad.id, accountId, provider: 'metricool', state: 'PUBLISHED', scheduledFor: new Date(Date.now() - 86400_000) } });
  await prisma.publicationResult.create({ data: { jobId: job.id, verifiedAt: new Date(Date.now() - 86400_000), ...(reach != null ? { metricsFetchedAt: new Date(), metrics: { reach } } : {}) } });
}

describe('Instagram account audit', () => {
  it('scores accounts from real published data and lists fixes, worst first', async () => {
    const { accounts } = await seedBase({ accounts: 2, productCount: 20, settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false, maxDailyAds: 100 } }) });
    setAiProviderOverride(new FakeAiProvider());
    await prisma.socialAccount.update({ where: { id: accounts[0].id }, data: { name: 'bhfcc.stickers', handle: 'bhfcc.stickers', formatStrategy: 'GROWTH_MIX', autoPublishEnabled: true, maxDailyAds: 20 } });
    await prisma.socialAccount.update({ where: { id: accounts[1].id }, data: { handle: 'bh.prints', formatStrategy: 'FIXED', publishFormat: 'IMAGE_STORY' } });
    for (const [f, r] of [['REEL_VIDEO', 80], ['REEL_VIDEO', 60], ['IMAGE_FEED', 10], ['IMAGE_FEED', 8]] as const) await published(accounts[0].id, f, r);
    const [worst, best] = await auditAccounts();
    expect(worst.id).toBe(accounts[1].id);
    expect(worst.issues.map((i) => i.id)).toEqual(expect.arrayContaining(['no_posts', 'auto_off', 'fixed_format']));
    expect(worst.issues.find((i) => i.id === 'fixed_format')!.fix[0].action).toMatchObject({ method: 'PATCH', body: { formatStrategy: 'GROWTH_MIX' } });
    expect(worst.grade).toBe('D');
    expect(best.kpi).toMatchObject({ posted: 4, reels: 2, feed: 2, avgReachReel: 70, avgReachOther: 9, measured: 4, daysSinceLast: 1 });
    expect(best.strengths.join()).toMatch(/الريلز تصل/);
    expect(best.issues.map((i) => i.id)).toContain('off_niche'); // stickers account without categories
    expect(best.score).toBeGreaterThan(worst.score);
  });
});
