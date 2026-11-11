import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { importMetrics } from '@/lib/analytics/import';
import { buildReport } from '@/lib/analytics/report';
import type { ProviderPostMetrics } from '@/lib/publishing/metricool';
import { generateAdvertisement } from '@/lib/pipeline/generate';
import { setAiProviderOverride } from '@/lib/ai';
import { captureQueues, FakeAdapter, FakeAiProvider, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });

/** Creates a VERIFIED publication (as reconcile would after provider confirmation). */
async function published(accountId: string, at: Date, url: string | null) {
  const r = await generateAdvertisement({ accountId, createdBy: 't' });
  const job = await prisma.publicationJob.create({ data: { idempotencyKey: `k-${r.advertisement.id}`, advertisementId: r.advertisement.id, accountId, provider: 'metricool', state: 'PUBLISHED', scheduledFor: at } });
  return prisma.publicationResult.create({ data: { jobId: job.id, providerPostId: 'x', providerStatus: 'PUBLISHED', publicUrl: url, verifiedAt: at } });
}

class AnalyticsAdapter extends FakeAdapter {
  rows: ProviderPostMetrics[] = []; calls = 0;
  async listPostMetrics() { this.calls++; return this.rows; }
}

describe('analytics import (read-only, verified posts only)', () => {
  it('matches by URL or a unique time match, skips ambiguous rows, never invents numbers', async () => {
    const { accounts } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false } }) });
    setAiProviderOverride(new FakeAiProvider());
    const t = new Date(Date.now() - 2 * 86400_000);
    const byUrl = await published(accounts[0].id, t, 'https://www.instagram.com/p/AAA/');
    const byTime = await published(accounts[0].id, new Date(t.getTime() + 3 * 3600_000), null);
    const ambiguous = await published(accounts[0].id, new Date(t.getTime() + 6 * 3600_000), null);
    const a = new AnalyticsAdapter();
    a.rows = [
      { kind: 'stories', url: 'https://instagram.com/p/AAA', reach: 1000, likes: 50, comments: 5, saves: 10, shares: 5, raw: {} },
      { kind: 'stories', publishedAt: new Date(t.getTime() + 3 * 3600_000 + 4 * 60_000), reach: 500, likes: 10, raw: {} },
      { kind: 'stories', publishedAt: new Date(t.getTime() + 6 * 3600_000 + 60_000), reach: 1, raw: {} },
      { kind: 'stories', publishedAt: new Date(t.getTime() + 6 * 3600_000 - 60_000), reach: 2, raw: {} },
    ];
    const r = await importMetrics(a);
    expect(r).toMatchObject({ candidates: 3, updated: 2, unmatched: 1 });
    const u = await prisma.publicationResult.findUniqueOrThrow({ where: { id: byUrl.id } });
    expect(u.engagementScore).toBeCloseTo(((50 + 10 + 30 + 15) / 1000) * 100);
    expect(u.metricsSource).toBe('metricool');
    expect((u.metrics as { matchedBy: string }).matchedBy).toBe('url');
    expect((await prisma.publicationResult.findUniqueOrThrow({ where: { id: byTime.id } })).engagementScore).toBeCloseTo(2);
    expect((await prisma.publicationResult.findUniqueOrThrow({ where: { id: ambiguous.id } })).engagementScore).toBeNull();
    // recently refreshed rows are not re-fetched; manual entries are never overwritten
    expect((await importMetrics(a)).candidates).toBe(1);
  });

  it('report uses only verified data and flags small samples', async () => {
    const { accounts } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false } }) });
    setAiProviderOverride(new FakeAiProvider());
    const r0 = await published(accounts[0].id, new Date(Date.now() - 86400_000), null);
    await prisma.publicationResult.update({ where: { id: r0.id }, data: { engagementScore: 4.2, metrics: { reach: 300, likes: 9 } } });
    const rep = await buildReport('week');
    expect(rep.metrics).toMatchObject({ posts: 1, withMetrics: 1, reach: 300, likes: 9, avgEngagement: 4.2 });
    expect(rep.recommendations.join(' ')).toMatch(/العينة صغيرة/);
    expect(rep.publishing.PUBLISHED).toBe(1);
  });
});
