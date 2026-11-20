import type { Prisma } from '@prisma/client';
import { formatInTimeZone } from 'date-fns-tz';
import { prisma } from '../db';
import type { PublishingAdapter } from '../publishing/types';
import type { BestTimeCell } from '../publishing/metricool';

/**
 * «⏰ أفضل وقت من Metricool» — Metricool's best-time heatmap (when each account's audience is most active, per
 * day of week and hour) is pulled daily for the coming week and kept per account. Peak-hour scheduling uses it
 * until the account has enough of its own measured posts (its own results always win). Read-only provider calls.
 */
export interface BestTimeGrid { at: string; network: string; grid: number[][] } // grid[isoDay 1..7][hour 0..23], 0–100
const key = (accountId: string) => `besttime:${accountId}`;

/** pure: cells → a 0–100 grid (exported for tests); null when Metricool gave nothing usable */
export function toGrid(cells: BestTimeCell[]): number[][] | null {
  if (!cells.length) return null;
  const max = Math.max(...cells.map((c) => c.value));
  if (!(max > 0)) return null;
  const grid = Array.from({ length: 8 }, () => new Array<number>(24).fill(0));
  for (const c of cells) grid[c.day][c.hour] = Math.round((c.value / max) * 100);
  return grid;
}

/** pure: the best hours of one day (ISO 1..7), or of the whole week when the day has no data */
export function rankHours(grid: number[][], isoDay: number, count: number): number[] {
  const row = grid[isoDay]?.some((v) => v > 0) ? grid[isoDay] : new Array<number>(24).fill(0).map((_, h) => grid.slice(1).reduce((s, r) => s + (r?.[h] ?? 0), 0));
  return row.map((v, hour) => ({ hour, v })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v || a.hour - b.hour).slice(0, count).map((x) => x.hour);
}

export async function bestTimeGrid(accountId: string): Promise<BestTimeGrid | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: key(accountId) } }).catch(() => null);
  return (row?.value as BestTimeGrid | undefined) ?? null;
}

/** the account's best hours for the day of `at` (Bahrain/account time) from the stored Metricool heatmap */
export async function metricoolBestHours(account: { id: string; timezone: string }, count: number, at = new Date()): Promise<number[] | null> {
  const g = await bestTimeGrid(account.id);
  if (!g) return null;
  const hours = rankHours(g.grid, Number(formatInTimeZone(at, account.timezone, 'i')), count);
  return hours.length ? hours : null;
}

/** daily: refresh every connected account's heatmap for its own network (one read-only call per account) */
export async function refreshBestTimes(adapter: PublishingAdapter, now = new Date()) {
  if (!adapter.bestTimes) return { skipped: 'ADAPTER_HAS_NO_BEST_TIMES', updated: 0 };
  const accounts = await prisma.socialAccount.findMany({ where: { connection: { providerBrandId: { not: null } } }, include: { connection: true } });
  let updated = 0; const errors: string[] = [];
  for (const a of accounts) {
    const network = a.platform === 'tiktok' ? 'tiktok' : a.platform === 'facebook' ? 'facebook' : 'instagram';
    try {
      const cells = await adapter.bestTimes(a.connection!.providerBrandId!, network, now, new Date(now.getTime() + 7 * 86400_000 - 1000), a.timezone);
      const grid = toGrid(cells);
      if (!grid) continue;
      const value = { at: now.toISOString(), network, grid } as unknown as Prisma.InputJsonValue;
      await prisma.systemSetting.upsert({ where: { key: key(a.id) }, create: { key: key(a.id), value, updatedBy: 'metricool' }, update: { value, updatedBy: 'metricool' } });
      updated++;
    } catch (e) { errors.push(`${a.name}: ${(e as Error).message.slice(0, 80)}`); }
  }
  return { updated, accounts: accounts.length, errors: errors.slice(0, 5) };
}
