import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { setPublishingAdapterOverride } from '@/lib/publishing/registry';
import { importCompetitorCsv, importCompetitors, competitorReport } from '@/lib/competitors/service';
import { runAdvisor } from '@/lib/ops/advisor';
import { captureQueues, FakeAdapter, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });

describe('competitor intelligence', () => {
  it('CSV: competitors table + posts file on the same day merge into one snapshot; report includes our row', async () => {
    const { accounts } = await seedBase();
    await prisma.socialAccount.update({ where: { id: accounts[0].id }, data: { handle: 'bhfcc.test' } });
    const a = await importCompetitorCsv('1000', 'screenName,followers\nrival.bh,1200\nbhfcc.test,16\n');
    expect(a).toMatchObject({ kind: 'competitors', rows: 2 });
    const b = await importCompetitorCsv('1000', 'screenName,content,likes,comments,timestamp,url\nrival.bh,"هدايا تخرج مخصصة",40,5,' + new Date(Date.now() - 2 * 86400_000).toISOString() + ',https://instagram.com/reel/A\nnew.bh,ملصقات,10,1,' + new Date().toISOString() + ',https://instagram.com/p/B\n');
    expect(b).toMatchObject({ kind: 'posts', rows: 2, snapshotId: a.snapshotId });
    const rep = await competitorReport('1000');
    expect(rep.snapshot?.source).toBe('csv');
    const handles = rep.analysis!.bench.map((x) => x.handle);
    expect(handles).toContain('rival.bh'); expect(handles).toContain('new.bh'); // seen only in posts → still benchmarked
    expect(rep.analysis!.bench.filter((x) => !x.isUs && x.handle === 'bhfcc.test')).toHaveLength(0); // our own handle is not a competitor…
    expect(rep.analysis!.bench.find((x) => x.isUs)).toMatchObject({ followers: 16 }); // …but its followers feed our row
    expect(rep.analysis!.topPosts[0]).toMatchObject({ handle: 'rival.bh', type: 'reel', interactions: 45 });
  });
  it('rejects files without an account column', async () => {
    await seedBase();
    await expect(importCompetitorCsv('1000', 'foo,bar\n1,2\n')).rejects.toThrow(/screenName/);
  });
  it('Metricool pull: parses competitors, posts and reels into a snapshot; errors are reported per brand', async () => {
    await seedBase();
    const a = new FakeAdapter() as FakeAdapter & { listCompetitorRows: unknown };
    a.listCompetitorRows = async (brandId: string) => {
      if (brandId === '1001') throw new Error('Metricool رفض الوصول');
      return { competitors: [{ screenName: 'rival.bh', followers: 900 }], posts: [{ screenName: 'rival.bh', content: 'كروت', likes: 3, timestamp: new Date().toISOString() }], reels: [{ screenName: 'rival.bh', content: 'ريل', likes: 30, timestamp: new Date().toISOString() }] };
    };
    setPublishingAdapterOverride(a);
    const r = await importCompetitors();
    expect(r).toMatchObject({ '1000': '1 competitors, 2 posts' });
    expect((r as Record<string, string>)['1001']).toMatch(/^ERROR/);
    const rep = await competitorReport('1000');
    expect(rep.analysis!.formats).toMatchObject({ reel: { n: 1 }, post: { n: 1 } });
  });
  it('advisor asks to add competitors when there is no data', async () => {
    await seedBase();
    expect((await runAdvisor()).advice.find((x) => x.id === 'no_competitors')).toBeDefined();
  });
});
