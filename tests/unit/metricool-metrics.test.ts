import { describe, expect, it } from 'vitest';
import { MetricoolAdapter, dateWindows, providerMessage, providerTime } from '@/lib/publishing/metricool';
import { summarizeErrors } from '@/lib/analytics/import';

type Call = { url: URL };
/** a fake Metricool: `plan(call, n)` returns [status, body] or throws (n = request number, from 1) */
function fake(plan: (u: URL, n: number) => [number, unknown] | Error) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL) => {
    const url = new URL(String(input)); calls.push({ url });
    const p = plan(url, calls.length);
    if (p instanceof Error) throw p;
    return new Response(typeof p[1] === 'string' ? p[1] : JSON.stringify(p[1]), { status: p[0] });
  }) as unknown as typeof fetch;
  const a = new MetricoolAdapter({ token: 't', userId: '5997357', baseUrl: 'https://app.metricool.com/api', fetchImpl, retryDelayMs: 0 });
  return { a, calls };
}
const abort = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
const from = new Date('2026-10-27T00:00:00Z'), to = new Date('2026-11-26T00:00:00Z');
// the real shape seen on the owner's account: compact local timestamp + permalink
const row = { timestamp: '20261126132101', url: 'https://www.instagram.com/p/DgNMs-kjUC2/', reach: '3', views: '7', likes: '1', comments: 0, saved: 0, shares: 0 };

describe('Metricool post metrics: the request is resilient and the reason of a failure is visible', () => {
  it('reads the compact local timestamp «yyyyMMddHHmmss» in the brand timezone (it used to be Invalid Date)', async () => {
    const { a, calls } = fake(() => [200, { data: [row] }]);
    const [m] = await a.listPostMetrics('7680808', 'posts', from, to, 'Asia/Bahrain');
    expect(m.publishedAt?.toISOString()).toBe('2026-11-26T10:21:01.000Z'); // 13:21 Bahrain = 10:21 UTC
    expect([m.reach, m.views, m.likes]).toEqual([3, 7, 1]);
    expect(calls).toHaveLength(1); // the normal case stays one request per brand and type
    expect(calls[0].url.pathname).toBe('/api/v2/analytics/posts/instagram');
    expect(calls[0].url.searchParams.get('userId')).toBe('5997357');
    expect(calls[0].url.searchParams.get('blogId')).toBe('7680808');
  });
  it('a request shape Metricool rejects (400) is retried once without the timezone parameter', async () => {
    const { a, calls } = fake((u) => (u.searchParams.has('timezone') ? [400, { message: 'Unknown parameter timezone' }] : [200, [row]]));
    expect(await a.listPostMetrics('1', 'reels', from, to)).toHaveLength(1);
    expect(calls.map((c) => c.url.searchParams.has('timezone'))).toEqual([true, false]);
  });
  it('a 5xx is retried once; a timeout on the whole range falls back to 7-day windows', async () => {
    const r1 = fake((_u, n) => (n === 1 ? [503, 'busy'] : [200, [row]]));
    expect(await r1.a.listPostMetrics('1', 'posts', from, to)).toHaveLength(1);
    expect(r1.calls).toHaveLength(2);
    // whole range: timeout twice (request + retry) → 30 days in 7-day windows, duplicates merged
    const r2 = fake((u, n) => (n <= 2 ? abort() : [200, [row]]));
    expect(await r2.a.listPostMetrics('1', 'posts', from, to)).toHaveLength(1);
    expect(r2.calls.length).toBe(2 + dateWindows(from, to, 7).length);
  });
  it('failures carry the HTTP code and Metricool\'s own message (no more silent «15 خطأ»)', async () => {
    await expect(fake(() => [403, { error: 'Plan without API access' }]).a.listPostMetrics('1', 'posts', from, to)).rejects.toThrow(/403/);
    await expect(fake(() => [404, '<html><body>Not Found</body></html>']).a.listPostMetrics('1', 'posts', from, to)).rejects.toThrow('Metricool HTTP 404: Not Found');
    await expect(fake(() => abort()).a.listPostMetrics('1', 'stories', new Date('2026-11-20'), new Date('2026-11-22'))).rejects.toThrow(/timeout/);
  });
});

describe('helpers', () => {
  it('provider times: compact, ISO with/without offset, epoch and {dateTime, timezone}', () => {
    expect(providerTime('20261126')?.toISOString()).toBe('2026-11-25T21:00:00.000Z');
    expect(providerTime('2026-11-06T14:00:00')?.toISOString()).toBe('2026-11-06T11:00:00.000Z');
    expect(providerTime('2026-11-01T10:00:00Z')?.toISOString()).toBe('2026-11-01T10:00:00.000Z');
    expect(providerTime(1_764_000_000)?.getTime()).toBe(1_764_000_000_000);
    expect(providerTime({ dateTime: '2026-11-06T14:00:00', timezone: 'Europe/Madrid' })?.toISOString()).toBe('2026-11-06T13:00:00.000Z');
    expect(providerTime('garbage')).toBeUndefined();
  });
  it('error summary groups by cause with an Arabic next step', () => {
    const s = summarizeErrors(['7680808/posts: Metricool HTTP timeout: انتهت مهلة الانتظار (90 ثانية)', '7839816/posts: Metricool HTTP timeout: انتهت مهلة الانتظار (90 ثانية)', '7841271/reels: Metricool HTTP 404: Not Found']);
    expect(s[0]).toMatchObject({ count: 2 });
    expect(s[0].hint).toContain('بطيء');
    expect(s[1].hint).toContain('صيغة الطلب');
    expect(providerMessage({ raw: '<h1>Bad  Request</h1>' })).toBe('Bad Request');
  });
});
