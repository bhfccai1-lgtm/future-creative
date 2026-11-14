import { describe, expect, it } from 'vitest';
import { buildSnapshot, type AccountInsight } from '@/lib/analytics/account-insights';
import { lastFollowerValue } from '@/lib/publishing/metricool';

const acc = (name: string, followers: number | null, reels: [number, number], posts: [number, number]): AccountInsight => ({
  accountId: name, name, handle: name, followers, saves: 0, shares: 0, best: [], systemPublished: 0,
  reels: { count: reels[0], reach: reels[0] * reels[1], avgReach: reels[1], interactions: 0 },
  posts: { count: posts[0], reach: posts[0] * posts[1], avgReach: posts[1], interactions: 0 },
});
// real 30-day figures from Metricool (14 Nov 2026)
export const REAL = [
  acc('Salmabad_adv', 5478, [1, 27], [0, 0]), acc('bhfcc.saar', 3226, [5, 20.8], [4, 29.25]), acc('bh.prints', 677, [3, 6], [2, 14]),
  acc('mhpssc', 164, [0, 0], [0, 0]), acc('saar_press', 150, [0, 0], [0, 0]), acc('bhfcc.education', 16, [6, 71], [3, 8.7]),
  acc('bhfcc.stickers', 12, [4, 57], [3, 6.3]), acc('bhfcc.occasions', 13, [3, 48], [2, 5.5]), acc('bhfcc.india', 12, [16, 11.3], [2, 7]),
  acc('bhfccai', 19, [0, 0], [7, 17.7]), acc('Ksafcc', 3, [1, 0], [5, 0]),
];

describe('account insights from real Metricool numbers', () => {
  const snap = buildSnapshot(REAL, 30, new Date('2026-11-14T08:00:00Z'));
  it('totals and reel vs post averages', () => {
    expect(snap.totals.followers).toBe(9770);
    expect(snap.totals.reelAvg).toBeGreaterThan(snap.totals.postAvg);
  });
  it('flags the neglected big accounts first (critical)', () => {
    const a = snap.advice.find((x) => x.level === 'critical')!;
    expect(a.accounts).toEqual(expect.arrayContaining(['Salmabad_adv', 'mhpssc', 'saar_press']));
    expect(a.accounts).not.toContain('bhfcc.education');
    expect(a.title).toMatch(/%/);
  });
  it('reels ×N, over-posting on tiny accounts, dormant big audience, no-reel and silent accounts, what works', () => {
    const t = snap.advice.map((x) => x.title).join(' | ');
    expect(snap.advice.find((x) => x.title.includes('الريلز تصل'))!.accounts).toEqual(expect.arrayContaining(['bhfcc.education', 'bhfcc.stickers', 'bhfcc.occasions']));
    expect(snap.advice.find((x) => x.title.includes('بلا جمهور'))!.accounts).toContain('bhfcc.india');
    expect(snap.advice.find((x) => x.title.includes('2%'))!.accounts).toContain('bhfcc.saar');
    expect(snap.advice.find((x) => x.title.includes('بلا ريلز'))!.accounts).toContain('bhfccai');
    expect(snap.advice.find((x) => x.title.includes('لم يُنشر'))!.accounts).toEqual(expect.arrayContaining(['mhpssc', 'saar_press']));
    expect(snap.advice.find((x) => x.level === 'good')!.accounts).toContain('bhfcc.education');
    expect(t).not.toMatch(/undefined|NaN/);
  });
  it('no follower data → no follower-based advice (never guessed)', () => {
    const s = buildSnapshot(REAL.map((a) => ({ ...a, followers: null })), 30);
    expect(s.advice.some((x) => x.level === 'critical')).toBe(false);
  });
  it('reads the latest follower value from different timeline shapes', () => {
    expect(lastFollowerValue({ data: [{ metric: 'followers', values: [{ dateTime: '2026-11-12T00:00:00', value: 3224 }, { dateTime: '2026-11-13T00:00:00', value: 3226 }] }] })).toBe(3226);
    expect(lastFollowerValue([['2026-11-10', '677'], ['2026-11-12', '680']])).toBe(680);
    expect(lastFollowerValue({ data: [] })).toBeNull();
  });
});
