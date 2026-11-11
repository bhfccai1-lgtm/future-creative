import { describe, expect, it } from 'vitest';
import { parseCsv, parseCompetitors, parseCompetitorPosts } from '@/lib/competitors/parse';
import { analyseCompetitors } from '@/lib/competitors/analysis';
import type { CompetitorPost } from '@/lib/competitors/types';

describe('competitor data parsing', () => {
  it('reads Metricool CSV exports (BOM, quotes, ; separator, Arabic headers) tolerantly', () => {
    const csv = '﻿screenName;displayName;followers;posts;reels\n@printco.bh;"Print Co; Bahrain";1,250;40;12\nhttps://instagram.com/giftsbh/;Gifts BH;980;22;30\n';
    const c = parseCompetitors(parseCsv(csv));
    expect(c).toEqual([{ handle: 'printco.bh', name: 'Print Co; Bahrain', followers: 1250, posts: 40, reels: 12, likes: undefined, comments: undefined, engagement: undefined }, expect.objectContaining({ handle: 'giftsbh', followers: 980 })]);
    const ar = parseCompetitors(parseCsv('الحساب,المتابعون\nmugs.bh,500\n'));
    expect(ar[0]).toMatchObject({ handle: 'mugs.bh', followers: 500 });
  });
  it('posts: type from field or /reel/ URL, interactions = likes + comments when missing, Data-Studio date format', () => {
    const p = parseCompetitorPosts([
      { screenName: 'a', content: 'كوب\n"تخرج"', likes: '10', comments: 2, timestamp: '20261105', url: 'https://instagram.com/reel/X' },
      { username: 'b', caption: 'x', interactions: 50, type: 'CAROUSEL_ALBUM' },
    ]);
    expect(p[0]).toMatchObject({ handle: 'a', type: 'reel', interactions: 12 });
    expect(p[0].publishedAt?.toISOString()).toBe('2026-11-05T09:00:00.000Z');
    expect(p[1]).toMatchObject({ handle: 'b', type: 'post', interactions: 50 });
  });
});

describe('competitor analysis', () => {
  const now = new Date('2026-11-11T09:00:00Z');
  const at = (d: number, h: number) => new Date(Date.UTC(2026, 10, d, h - 3)); // Bahrain hour h
  const post = (handle: string, type: 'post' | 'reel', interactions: number, d: number, h: number, caption: string): CompetitorPost => ({ handle, type, interactions, publishedAt: at(d, h), caption });
  const posts: CompetitorPost[] = [
    ...[1, 2, 3, 4, 5, 6].map((d) => post('fast', 'reel', 90 + d, d, 20, 'هدايا تخرج مخصصة بصورة الخريج #تخرج')),
    ...[1, 3, 5, 7, 9, 10].map((d) => post('fast', 'post', 30, d, 11, 'طباعة كروت شركات')),
    ...[2, 4, 6].map((d) => post('slow', 'post', 20, d, 11, 'ملصقات منتجات للمشاريع #ملصقات')),
    post('slow', 'reel', 25, 8, 20, 'هدايا تخرج للأطفال'),
  ];
  const r = analyseCompetitors({
    now, latest: [{ handle: 'fast', followers: 2000 }, { handle: 'slow', followers: 1000 }],
    previous: [{ handle: 'fast', followers: 1800 }, { handle: 'slow', followers: 990 }], previousDaysAgo: 7, posts,
    us: { name: 'bhfcc.mugs', followers: 16, posts: [{ type: 'post', caption: 'طباعة كروت شركات', publishedAt: at(5, 10), interactions: 3 }] },
  });
  it('benchmark: growth, frequency, reel share, engagement rate; our row included', () => {
    const fast = r.bench.find((b) => b.handle === 'fast')!;
    expect(fast).toMatchObject({ followerGrowth: 200, followerGrowthPct: 11.1, reelShare: 50, sample: 12 });
    expect(fast.postsPerWeek).toBeCloseTo(2.8, 1);
    expect(r.bench.find((b) => b.isUs)).toMatchObject({ handle: 'bhfcc.mugs', postsPerWeek: 0.2, avgInteractions: 3 });
  });
  it('formats, timing, themes and gaps come from the data with sample sizes', () => {
    expect(r.formats.reelLift).toBeGreaterThan(2);
    expect(r.bestSlots[0]).toMatchObject({ hour: 20, n: 7 });
    expect(r.themes.map((t) => t.word)).toContain('تخرج');
    expect(r.gaps).toContain('تخرج'); // successful for them, unused by us
    expect(r.gaps).not.toContain('كروت'); // we already use it
    const opp = r.opportunities.join(' ');
    expect(opp).toMatch(/وتيرة النشر/); expect(opp).toMatch(/الريلز/); expect(opp).toMatch(/@fast/); expect(opp).toMatch(/العينة صغيرة/);
  });
  it('no data → no invented numbers', () => {
    const e = analyseCompetitors({ now, latest: [{ handle: 'x' }], posts: [] });
    expect(e.bench[0]).toMatchObject({ followers: null, avgInteractions: null, engagementRate: null, postsPerWeek: null });
    expect(e.opportunities.join(' ')).toMatch(/لا توجد منشورات منافسين/);
  });
});
