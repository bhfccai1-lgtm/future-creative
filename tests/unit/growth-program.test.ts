import { describe, expect, it } from 'vitest';
import { buildSnapshot, type AccountInsight } from '@/lib/analytics/account-insights';
import { baselineOf, diagnose, pickFromWeek, PHASES, targetsFor, weekOf } from '@/lib/growth/program';

const fs = (count: number, avgReach: number, inter = 0) => ({ count, reach: count * avgReach, avgReach, interactions: inter });
const acc = (id: string, followers: number | null, reels: [number, number, number?], posts: [number, number, number?], saves = 0): AccountInsight =>
  ({ accountId: id, name: id, handle: null, followers, reels: fs(...(reels as [number, number, number])), posts: fs(...(posts as [number, number, number])), saves, shares: 0, best: [], systemPublished: 0 });

describe('growth program', () => {
  const big = acc('big', 5478, [2, 60, 4], [2, 20, 1]);
  const snap = buildSnapshot([big, acc('small', 30, [0, 0], [5, 8, 2]), acc('mid', 400, [3, 50, 20], [3, 40, 15], 12)], 30);

  it('baseline numbers come straight from the snapshot', () => {
    const b = baselineOf(big);
    expect(b).toMatchObject({ followers: 5478, content: 4, reachPerContent: 40, reelAvg: 60, postAvg: 20 });
    expect(b.reachRate).toBe(0.7); // 40 / 5478
    expect(b.engagementRate).toBe(3.1); // 5 / 160
  });
  it('targets are modest and tier-based', () => {
    expect(targetsFor('grow', baselineOf(big), 120)).toEqual({ followers: 5643, reachPerContent: 56, contents: 120 });
    expect(targetsFor('light', baselineOf(snap.accounts[1]), 15).followers).toBe(50); // +20 minimum
    expect(targetsFor('steady', { ...baselineOf(big), reachPerContent: 0 }, 60).reachPerContent).toBeNull();
  });
  it('diagnosis lines are grounded in numbers', () => {
    const f = diagnose(big, snap).map((x) => x.text).join('\n');
    expect(f).toMatch(/من كل جمهورك/); expect(f).toMatch(/0\.7%/); expect(f).toMatch(/×3\.0/);
    expect(diagnose(snap.accounts[1], snap).some((x) => x.text.includes('لا يوجد ريلز'))).toBe(true);
    expect(diagnose(snap.accounts[2], snap).some((x) => x.kind === 'strength' && x.text.includes('حفظ'))).toBe(true);
  });
  it('weeks advance by day and the program ends after 30 days', () => {
    const start = new Date('2026-11-01T06:00:00Z');
    const p = { startedAt: start.toISOString(), endsAt: new Date(start.getTime() + 30 * 86400_000).toISOString() };
    const at = (d: number) => new Date(start.getTime() + d * 86400_000 + 3600_000);
    expect([0, 6, 7, 13, 14, 21, 29].map((d) => weekOf(p, at(d)))).toEqual([1, 1, 2, 2, 3, 4, 4]);
    expect(weekOf(p, at(30))).toBe('done');
  });
  it('picks the week\'s angle, avoiding the most recent ones', () => {
    const types = PHASES[1].contentTypes;
    for (let i = 0; i < 20; i++) expect(types).toContain(pickFromWeek(types, []));
    expect(pickFromWeek(types, [types[0], types[1]], () => 0)).toBe(types[2]);
  });
});
