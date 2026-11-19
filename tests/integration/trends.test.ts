import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { updateSettings } from '@/lib/settings';
import { setAiProviderOverride } from '@/lib/ai';
import { isSensitive, lastRadar, parseTrendsRss, runTrendRadar, trendIdeas, volumeOf } from '@/lib/growth/trends';
import { runReadTool } from '@/lib/assistant/agent';
import { captureQueues, FakeAiProvider, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });

const item = (title: string, traffic: string, news: string) => `<item><title>${title}</title><ht:approx_traffic>${traffic}</ht:approx_traffic><ht:news_item><ht:news_item_title><![CDATA[${news}]]></ht:news_item_title></ht:news_item></item>`;
const RSS: Record<string, string> = {
  BH: `<?xml version="1.0"?><rss><channel>${item('منتخب البحرين', '20K+', 'البحرين تفوز وتتأهل لنهائي كأس الخليج')}${item('وفاة فنان', '50K+', 'وفاة فنان مشهور')}${item('العيد الوطني', '5K+', 'استعدادات الاحتفال بالعيد الوطني')}</channel></rss>`,
  SA: `<?xml version="1.0"?><rss><channel>${item('موسم الرياض', '100K+', 'انطلاق فعاليات موسم الرياض')}${item('Gaza news', '200K+', 'war update')}</channel></rss>`,
};
const fakeFetch = (async (url: string) => { const g = new URL(url).searchParams.get('geo')!; return new Response(RSS[g] ?? '<rss/>', { status: 200 }); }) as unknown as typeof fetch;

class Scripted extends FakeAiProvider {
  seen: string[] = []; answer: unknown = { ideas: [] };
  async generateJson(_s: string, user: string) { this.seen.push(user); return { json: this.answer, usage: { inputTokens: 1500, outputTokens: 300 }, model: 'fake-text' }; }
}

describe('🔥 trend radar (real searches → safe, product-matched ideas)', () => {
  it('parses the Google Trends feed, sorts by volume and drops bad news', () => {
    const t = parseTrendsRss(RSS.BH, 'BH');
    expect(t.map((x) => x.title)).toEqual(['وفاة فنان', 'منتخب البحرين', 'العيد الوطني']);
    expect(t[1]).toMatchObject({ traffic: '20K+', volume: 20000, news: ['البحرين تفوز وتتأهل لنهائي كأس الخليج'] });
    expect(isSensitive(t[0])).toBe(true); expect(isSensitive(t[1])).toBe(false);
    expect(parseTrendsRss(item('Tom &amp; Jerry &amp;quot;', '1K+', 'x'), 'BH')[0].title).toBe('Tom & Jerry &quot;'); // decoded once
    expect(volumeOf('1M+')).toBe(1_000_000); expect(volumeOf('2,000+')).toBe(2000);
  });

  it('off by default; when run, only safe trends reach the AI, and only valid ideas reach the bank as NEW', async () => {
    const { accounts } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false } }) });
    expect(await runTrendRadar({ fetchImpl: fakeFetch })).toEqual({ skipped: true });
    await updateSettings((s) => ({ ...s, trends: { ...s.trends, enabled: true } }));
    const product = await prisma.product.findFirstOrThrow();
    const ai = new Scripted(); setAiProviderOverride(ai);
    ai.answer = { ideas: [
      { trend: 'منتخب البحرين', accountId: accounts[0].id, productId: product.id, title: 'كوب الأبطال', idea: 'كوب بعلم البحرين وتاريخ الفوز', hook: 'شفت الهدف؟ خلّه على كوبك!', format: 'REEL_VIDEO', score: 9, why: 'فرحة وطنية' },
      { trend: 'ترند مخترع', accountId: accounts[0].id, productId: product.id, title: 'x', idea: 'y' }, // not a real trend → dropped
      { trend: 'العيد الوطني', accountId: 'nope', productId: product.id, title: 'x', idea: 'y' }, // unknown account → dropped
    ] };
    const r = await runTrendRadar({ fetchImpl: fakeFetch });
    if ('skipped' in r) throw new Error('should run');
    expect(r.geos.BH.map((t) => t.title)).toEqual(['منتخب البحرين', 'العيد الوطني']);
    expect(r.geos.SA.map((t) => t.title)).toEqual(['موسم الرياض']);
    expect(r.blocked).toBe(2); expect(r.ideas).toBe(1); expect(r.source).toBe('ai');
    expect(ai.seen[0]).not.toMatch(/وفاة|Gaza/); // bad news never reaches the model
    const ideas = await trendIdeas();
    expect(ideas).toHaveLength(1);
    expect(ideas[0]).toMatchObject({ trend: 'منتخب البحرين', status: 'NEW', title: 'كوب الأبطال' });
    expect((await prisma.idea.findFirstOrThrow({ where: { source: 'trend' } })).why).toMatch(/🔥 ترند في البحرين \(20K\+\)/);
    expect((await lastRadar())?.ideas).toBe(1);
    // the same trend is not proposed twice in 3 days
    expect(((await runTrendRadar({ fetchImpl: fakeFetch })) as { ideas: number }).ideas).toBe(0);
    // trends die: an unapproved idea expires after 3 days
    const r3 = await runTrendRadar({ fetchImpl: fakeFetch, now: new Date(Date.now() + 4 * 86400_000) });
    expect('skipped' in r3).toBe(false);
    expect((await prisma.idea.findFirstOrThrow({ where: { source: 'trend', title: 'كوب الأبطال' } })).status).toBe('REJECTED');
    // the assistant can read it
    const t = (await runReadTool('trends', {})) as { trends: { country: string; top: string[] }[] };
    expect(t.trends.find((x) => x.country === 'BH')?.top[0]).toMatch(/منتخب البحرين/);
  });

  it('without an AI key it still shows the safe trends (no ideas); a failed fetch is reported, not thrown', async () => {
    await seedBase();
    await updateSettings((s) => ({ ...s, trends: { ...s.trends, enabled: true } }));
    const r = await runTrendRadar({ fetchImpl: fakeFetch }) as { ideas: number; source: string; geos: Record<string, unknown[]> };
    expect(r.ideas).toBe(0); expect(r.source).toBe('numbers'); expect(r.geos.SA).toHaveLength(1);
    const down = (async () => new Response('', { status: 503 })) as unknown as typeof fetch;
    const r2 = await runTrendRadar({ fetchImpl: down }) as { error?: string; source: string };
    expect(r2.error).toMatch(/HTTP 503/); expect(r2.source).toBe('none');
  });
});
describe('safety filter', () => {
  it('blocks bad news but not innocent words', () => {
    for (const t of ['وفاة لاعب', 'حادث مروري', 'war in X', 'Fire at mall']) expect(isSensitive({ title: t, news: [] })).toBe(true);
    for (const t of ['award show', 'fireworks night', 'سنة جديدة سعيدة', 'deadline اليوم']) expect(isSensitive({ title: t, news: [] })).toBe(false);
  });
});
