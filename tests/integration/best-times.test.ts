import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { parseBestTimes } from '@/lib/publishing/metricool';
import { bestTimeGrid, rankHours, refreshBestTimes, toGrid } from '@/lib/growth/best-time';
import { peakHoursFor } from '@/lib/growth/peak-hours';
import type { PublishingAdapter } from '@/lib/publishing/types';
import { captureQueues, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });

// the shape Metricool returned for a real brand (values trimmed): Friday = 5, peaks at 10:00 and 18:00
const hours = (peaks: Record<number, number>) => Array.from({ length: 24 }, (_, h) => ({ hourOfDay: h, value: peaks[h] ?? 100 + h }));
const SAMPLE = { data: [
  { dayOfWeek: 5, bestTimesByHour: hours({ 10: 6734, 11: 5952, 12: 5909, 18: 4418 }) },
  { dayOfWeek: 6, bestTimesByHour: hours({ 10: 3409, 18: 2393, 12: 2822 }) },
  { dayOfWeek: 3, bestTimesByHour: hours({ 10: 6506, 18: 4869, 11: 6063 }) },
] };

describe('⏰ Metricool best time to post', () => {
  it('parses the heatmap, normalises it 0–100 and ranks the hours of a day', () => {
    const cells = parseBestTimes(SAMPLE);
    expect(cells).toHaveLength(72);
    expect(parseBestTimes([{ dayOfWeek: 1, hourOfDay: 9, value: 5 }, { dayOfWeek: 9, hourOfDay: 1, value: 1 }])).toEqual([{ day: 1, hour: 9, value: 5 }]); // flat form; bad days dropped
    expect(parseBestTimes({ error: 'x' })).toEqual([]);
    const grid = toGrid(cells)!;
    expect(grid[5][10]).toBe(100);
    expect(rankHours(grid, 5, 3)).toEqual([10, 11, 12]);
    expect(rankHours(grid, 3, 2)).toEqual([10, 11]);
    expect(rankHours(grid, 1, 2)).toEqual([10, 11]); // a day without data → the week's ranking
    expect(toGrid([])).toBeNull();
  });

  it('refreshes every connected account (read-only) and drives peak hours until the account has its own data', async () => {
    const { accounts } = await seedBase();
    const acc = accounts[0];
    await prisma.socialConnection.upsert({ where: { accountId: acc.id }, create: { accountId: acc.id, provider: 'metricool', providerBrandId: '7680808', status: 'CONNECTED' }, update: { providerBrandId: '7680808', status: 'CONNECTED' } });
    const calls: string[] = [];
    const adapter = { bestTimes: async (brand: string, network: string) => { calls.push(`${brand}:${network}`); return parseBestTimes(SAMPLE); } } as unknown as PublishingAdapter;
    const r = await refreshBestTimes(adapter, new Date('2026-11-20T06:00:00Z'));
    expect(r.updated).toBe(calls.length);
    expect(calls).toContain('7680808:instagram');
    expect((await bestTimeGrid(acc.id))?.network).toBe('instagram');
    // Friday 20 Nov 2026 in Bahrain: no measured posts yet → Metricool's hours for that day
    const p = await peakHoursFor(acc, 3, undefined, new Date('2026-11-20T09:00:00Z'));
    expect(p).toMatchObject({ source: 'metricool', hours: [10, 11, 12] });
    // an account without a heatmap keeps the built-in default
    const plain = accounts[1];
    await prisma.systemSetting.deleteMany({ where: { key: `besttime:${plain.id}` } });
    expect((await peakHoursFor(plain, 3)).source).toBe('default');
    // an adapter without the feature is skipped, never fails
    expect(await refreshBestTimes({} as PublishingAdapter)).toMatchObject({ skipped: 'ADAPTER_HAS_NO_BEST_TIMES' });
  });
});
