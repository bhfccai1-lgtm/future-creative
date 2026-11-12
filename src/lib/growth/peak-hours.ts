import { formatInTimeZone } from 'date-fns-tz';
import { prisma } from '../db';
import { BEST_HOURS_RANKED } from '../campaigns/slots';
import { inWindow } from '../time';

/**
 * Peak hours per account, learned from the account's OWN verified results (Metricool reach/views),
 * ranked by median reach per local hour. Until there is enough data (≥ 12 measured posts over ≥ 4 hours),
 * the brand-level ranking from Metricool's best-time data is used. Never invented.
 */
export interface PeakHours { hours: number[]; source: 'data' | 'default'; sample: number; ranked: { hour: number; medianReach: number; posts: number }[] }

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export async function peakHoursFor(account: { id: string; timezone: string }, count = 6, since = new Date(Date.now() - 90 * 86400_000)): Promise<PeakHours> {
  const rows = await prisma.publicationResult.findMany({
    where: { verifiedAt: { gte: since }, metricsFetchedAt: { not: null }, job: { accountId: account.id, primary: true } },
    select: { metrics: true, job: { select: { scheduledFor: true } } },
  });
  const byHour = new Map<number, number[]>();
  for (const r of rows) {
    const m = (r.metrics ?? {}) as { reach?: number | null; views?: number | null };
    const reach = m.reach ?? m.views;
    if (reach == null || reach <= 0) continue;
    const h = Number(formatInTimeZone(r.job.scheduledFor, account.timezone, 'H'));
    byHour.set(h, [...(byHour.get(h) ?? []), reach]);
  }
  const sample = [...byHour.values()].reduce((n, v) => n + v.length, 0);
  const ranked = [...byHour].map(([hour, v]) => ({ hour, medianReach: Math.round(median(v)), posts: v.length })).sort((a, b) => b.medianReach - a.medianReach);
  if (sample < 12 || byHour.size < 4) return { hours: BEST_HOURS_RANKED.slice(0, count), source: 'default', sample, ranked };
  // hours with only one post are noisy: rank them after hours with ≥ 2 posts
  const solid = ranked.filter((r) => r.posts >= 2).map((r) => r.hour);
  const hours = [...solid, ...ranked.filter((r) => r.posts < 2).map((r) => r.hour), ...BEST_HOURS_RANKED].filter((h, i, a) => a.indexOf(h) === i).slice(0, count);
  return { hours, source: 'data', sample, ranked };
}

/** true when `slotAt` is not a peak hour but a peak hour comes within `maxDelayHours` inside the account window. */
export function shouldWaitForPeak(slotAt: Date, peak: number[], a: { publishWindowStart: string; publishWindowEnd: string; timezone: string }, maxDelayHours: number) {
  const hourOf = (d: Date) => Number(formatInTimeZone(d, a.timezone, 'H'));
  if (peak.includes(hourOf(slotAt))) return false;
  for (let k = 1; k <= maxDelayHours; k++) {
    const t = new Date(slotAt.getTime() + k * 3600_000);
    if (inWindow(t, a.publishWindowStart, a.publishWindowEnd, a.timezone) && peak.includes(hourOf(t))) return true;
  }
  return false;
}
