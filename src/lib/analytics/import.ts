import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { audit } from '../audit';
import type { PublishingAdapter } from '../publishing/types';
import type { ProviderPostMetrics } from '../publishing/metricool';
import { engagementRate } from './score';
import { log } from '../ops/log';

const MATCH_WINDOW_MS = 20 * 60_000;
const kindOf = (format: string): ProviderPostMetrics['kind'] => (format === 'REEL_VIDEO' ? 'reels' : format === 'IMAGE_STORY' ? 'stories' : 'posts');
const normUrl = (u?: string | null) => (u ? u.split('?')[0].replace(/\/+$/, '').replace(/^https?:\/\/(www\.)?/i, '').toLowerCase() : null);

/**
 * Match one of our VERIFIED publications to a provider analytics row.
 * 1) exact public URL; 2) otherwise the ONLY row of the same kind published within ±20 min of our slot.
 * Ambiguous or missing matches are skipped — metrics are never guessed.
 */
export function matchMetrics(pub: { publicUrl?: string | null; scheduledFor: Date; format: string }, rows: ProviderPostMetrics[]) {
  const url = normUrl(pub.publicUrl);
  if (url) { const hit = rows.find((r) => normUrl(r.url) === url); if (hit) return { row: hit, method: 'url' as const }; }
  const kind = kindOf(pub.format);
  const near = rows.filter((r) => r.kind === kind && r.publishedAt && Math.abs(r.publishedAt.getTime() - pub.scheduledFor.getTime()) <= MATCH_WINDOW_MS);
  return near.length === 1 ? { row: near[0], method: 'time' as const } : null;
}

/**
 * Imports authorised metrics for verified publications of the last `days` days (read-only provider calls,
 * one request per brand and post type). Rows refreshed less than `minAgeH` hours ago are skipped.
 */
export async function importMetrics(adapter: PublishingAdapter, opts: { days?: number; minAgeH?: number; now?: Date } = {}) {
  if (!adapter.listPostMetrics) return { skipped: 'ADAPTER_HAS_NO_ANALYTICS', updated: 0 };
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - (opts.days ?? 30) * 86400_000);
  const stale = new Date(now.getTime() - (opts.minAgeH ?? 12) * 3600_000);
  const results = await prisma.publicationResult.findMany({
    where: { verifiedAt: { gte: since }, AND: [{ OR: [{ metricsFetchedAt: null }, { metricsFetchedAt: { lt: stale } }] }, { OR: [{ metricsSource: null }, { metricsSource: { not: 'manual' } }] }] }, // NULL-safe: manual entries are never overwritten
    include: { job: { include: { advertisement: { select: { format: true } }, account: { include: { connection: true } } } } },
  });
  const byBrand = new Map<string, typeof results>();
  for (const r of results) {
    const b = r.job.account.connection?.providerBrandId; if (!b) continue;
    byBrand.set(b, [...(byBrand.get(b) ?? []), r]);
  }
  let updated = 0, unmatched = 0; const errors: string[] = [];
  for (const [brandId, rows] of byBrand) {
    const tz = rows[0].job.account.timezone;
    const from = new Date(Math.min(...rows.map((r) => r.job.scheduledFor.getTime())) - 86400_000);
    const kinds = [...new Set(rows.map((r) => kindOf(r.job.advertisement.format)))];
    const provider: ProviderPostMetrics[] = [];
    for (const k of kinds) {
      try { provider.push(...(await adapter.listPostMetrics(brandId, k, from, now, tz))); }
      catch (e) { errors.push(`${brandId}/${k}: ${(e as Error).message}`); }
    }
    for (const r of rows) {
      const m = matchMetrics({ publicUrl: r.publicUrl, scheduledFor: r.job.scheduledFor, format: r.job.advertisement.format }, provider);
      if (!m) { unmatched++; continue; }
      const { reach, views, likes, comments, saves, shares, watchTimeSec, profileVisits, follows, retentionPct, skipRatePct, durationSec, postId } = m.row;
      const metrics = { reach, views, likes, comments, saves, shares, watchTimeSec, profileVisits, follows, retentionPct, skipRatePct, durationSec };
      const score = engagementRate(metrics);
      await prisma.publicationResult.update({
        where: { id: r.id },
        data: { metrics: { ...metrics, providerMediaId: postId ?? null, matchedBy: m.method } as Prisma.InputJsonValue, engagementScore: score, metricsFetchedAt: now, metricsSource: 'metricool' },
      });
      updated++;
    }
  }
  if (errors.length) log.warn('analytics.import.errors', { errors });
  await audit({ actorLabel: 'worker', action: 'analytics.import', details: { candidates: results.length, updated, unmatched, errors: errors.slice(0, 10) } });
  return { candidates: results.length, updated, unmatched, errors };
}
