import { describe, expect, it } from 'vitest';
import { buildSnapshot, type AccountInsight } from '@/lib/analytics/account-insights';
import { buildPostingPlan, planMonthlyCost, postsPerDay, windowMinutes, type PlanCurrent } from '@/lib/analytics/posting-plan';

const fs = (count: number, avgReach: number) => ({ count, reach: count * avgReach, avgReach, interactions: 0 });
const acc = (id: string, followers: number | null, reels: [number, number], posts: [number, number], error?: string): AccountInsight =>
  ({ accountId: id, name: id, handle: null, followers, reels: fs(...reels), posts: fs(...posts), saves: 0, shares: 0, best: [], systemPublished: 0, error });
const cur = (o: Partial<PlanCurrent> = {}): PlanCurrent => ({ publishIntervalMinutes: 420, maxDailyAds: 10, formatStrategy: 'FIXED', formatMix: null, publishWindowStart: '09:00', publishWindowEnd: '22:00', autoPublishEnabled: true, ...o });

describe('smart posting plan', () => {
  const snap = buildSnapshot([
    acc('big', 5478, [2, 300], [2, 40]),
    acc('mid', 400, [1, 20], [5, 30]),
    acc('small', 120, [3, 10], [3, 30]),
    acc('tiny', 12, [0, 0], [14, 5]),
    acc('broken', 900, [0, 0], [0, 0], 'timeout'),
  ], 30);
  const current = Object.fromEntries(['big', 'mid', 'small', 'tiny', 'broken'].map((k) => [k, cur()]));
  const plan = buildPostingPlan(snap, current);
  const row = (id: string) => plan.find((r) => r.accountId === id)!;

  it('tiers by real followers and skips accounts whose data failed', () => {
    expect(row('big').tier).toBe('grow');
    expect(row('big').intervalMinutes).toBe(240);
    expect(row('tiny').tier).toBe('light');
    expect(row('small').tier).toBe('steady');
    expect(plan.find((r) => r.accountId === 'broken')).toBeUndefined();
    expect(plan[0].accountId).toBe('big'); // biggest audience first
  });
  it('mix follows measured reach: reels-first, images-first, or the default', () => {
    expect(row('big').mix.REEL_VIDEO).toBe(70); // ×7.5
    expect(row('small').mix.IMAGE_FEED).toBe(50); // images reach more
    expect(row('mid').mix).toEqual({ REEL_VIDEO: 60, IMAGE_FEED: 30, IMAGE_STORY: 10 }); // too few reels to judge
  });
  it('flags only accounts that differ, and a matching account is not changed', () => {
    const r = row('big');
    const again = buildPostingPlan(snap, { ...current, big: cur({ publishIntervalMinutes: r.intervalMinutes, maxDailyAds: r.maxDaily, formatStrategy: 'GROWTH_MIX', formatMix: r.mix }) });
    expect(again.find((x) => x.accountId === 'big')!.changed).toBe(false);
    expect(row('big').changed).toBe(true);
  });
  it('posts a day respects window, interval and cap; cost counts only auto-publishing accounts', () => {
    expect(windowMinutes('09:00', '22:00')).toBe(780);
    expect(windowMinutes('20:00', '02:00')).toBe(360);
    expect(postsPerDay(240, 4, '09:00', '22:00')).toBe(4);
    expect(postsPerDay(420, 10, '09:00', '22:00')).toBe(2);
    expect(postsPerDay(2880, 1, '09:00', '22:00')).toBe(0.5);
    const off = buildPostingPlan(snap, Object.fromEntries(Object.keys(current).map((k) => [k, cur({ autoPublishEnabled: false })])));
    expect(planMonthlyCost(off, () => 0.1, 'plan')).toBe(0);
    expect(planMonthlyCost(plan, () => 0.1, 'plan')).toBeGreaterThan(0);
  });
});
