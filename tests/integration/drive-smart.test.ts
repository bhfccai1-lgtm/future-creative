import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { setSecret } from '@/lib/settings';
import { setAiProviderOverride } from '@/lib/ai';
import { generateAdvertisement } from '@/lib/pipeline/generate';
import { appsScriptSource } from '@/lib/integrations/google-archive';
import { curateBest, monthlyReport, syncMetricsToDrive } from '@/lib/integrations/drive-smart';
import { captureQueues, FakeAiProvider, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });
const URL_ = 'https://script.google.com/macros/s/AKfycbTESTTESTTESTTESTTEST/exec';
const calls: { event: string; data: Record<string, unknown> }[] = [];
const script = (async (_u: string, init: { body: string }) => {
  const b = JSON.parse(init.body); calls.push(b);
  const ans = b.event === 'metrics.update' ? { updated: b.data.rows.length } : b.event === 'best.copy' ? { copied: b.data.fileIds.length } : { url: 'https://docs.google.com/document/d/R1' };
  return new Response(JSON.stringify({ ok: true, ...ans }), { status: 200 });
}) as unknown as typeof fetch;

async function measuredAd(accountId: string, views: number, i: number, onDrive = true) {
  const { advertisement: ad } = await generateAdvertisement({ accountId, createdBy: 't', format: 'IMAGE_FEED' });
  await prisma.advertisement.update({ where: { id: ad.id }, data: { state: 'PUBLISHED' } });
  const at = new Date(Date.now() - (5 + i) * 86400_000);
  const job = await prisma.publicationJob.create({ data: { idempotencyKey: `k-${ad.id}`, advertisementId: ad.id, accountId, provider: 'metricool', state: 'PUBLISHED', scheduledFor: at } });
  await prisma.publicationResult.create({ data: { jobId: job.id, verifiedAt: at, metricsFetchedAt: new Date(), metricsSource: 'metricool', metrics: { views, reach: views - 2, saves: i, retentionPct: 50, skipRatePct: 40 } } });
  if (onDrive) for (const m of await prisma.mediaAsset.findMany({ where: { advertisementId: ad.id, role: 'FINAL' } })) await prisma.mediaAsset.update({ where: { id: m.id }, data: { meta: { drive: { id: `D-${m.id}`, size: m.bytes, url: 'x', at: 'now' } } } });
  return ad;
}

describe('smart Google Drive (script v3)', () => {
  it('nightly: real numbers to the sheet; the best designs per account into «⭐ أفضل التصاميم» once', async () => {
    const { accounts } = await seedBase();
    await setSecret('GOOGLE_ARCHIVE_URL', URL_, 't'); calls.length = 0;
    const a = await measuredAd(accounts[0].id, 120, 1), b = await measuredAd(accounts[0].id, 15, 2), c = await measuredAd(accounts[0].id, 60, 3, false);
    const m = await syncMetricsToDrive({ fetchImpl: script });
    expect(m).toMatchObject({ sent: 3, updated: 3 });
    expect((calls[0].data.rows as { adId: string; views: number }[]).find((r) => r.adId === a.id)?.views).toBe(120);
    const best = await curateBest({ fetchImpl: script });
    expect(best.designs).toBe(1); // b: under 20 views; c: no Drive copy yet
    const copy = calls.find((x) => x.event === 'best.copy')!;
    expect(copy.data.account).toBe(accounts[0].name);
    expect(String(copy.data.prefix)).toMatch(/120 مشاهدة/);
    expect((await curateBest({ fetchImpl: script })).designs).toBe(0); // once only
    void b; void c;
  });

  it('monthly report: written by the AI from the numbers, or from the numbers alone', async () => {
    const { accounts } = await seedBase();
    await setSecret('GOOGLE_ARCHIVE_URL', URL_, 't'); calls.length = 0;
    await measuredAd(accounts[0].id, 80, 1);
    const plain = await monthlyReport({ now: new Date('2026-12-01T05:00:00Z'), fetchImpl: script });
    expect(plain).toMatchObject({ title: 'تقرير نوفمبر 2026 — إبداع المستقبل', source: 'numbers', url: 'https://docs.google.com/document/d/R1' });
    class AiReport extends FakeAiProvider { async generateJson() { return { json: { blocks: [{ type: 'h1', text: 'تقرير' }, { type: 'p', text: 'ملخص' }, { type: 'h2', text: 'أهم النتائج' }, { type: 'li', text: 'نتيجة' }, { type: 'li', text: 'نتيجة ٢' }] }, usage: { inputTokens: 3000, outputTokens: 600 }, model: 'fake-text' }; } }
    setAiProviderOverride(new AiReport());
    const ai = await monthlyReport({ now: new Date('2026-12-01T05:00:00Z'), fetchImpl: script });
    expect(ai.source).toBe('ai');
    const doc = calls.filter((x) => x.event === 'report.doc').at(-1)!;
    expect((doc.data.blocks as { text: string }[]).map((x) => x.text)).toEqual(expect.arrayContaining(['ملخص', 'الأرقام كما سجّلها Metricool']));
    expect(await prisma.notification.count({ where: { code: 'DRIVE_MONTHLY_REPORT' } })).toBeGreaterThanOrEqual(1);
  });

  it('the v4 script keeps the smart events and adds the auth key, SHA-256 and the live verification', () => {
    const src = appsScriptSource({ folderId: 'F', sheetId: 'S', host: 'h', key: 'K' });
    expect(src).toContain('const VERSION = 4;');
    for (const fn of ['function metricsUpdate', 'function bestCopy', 'function reportDoc', '⭐ أفضل التصاميم', 'DocumentApp.create']) expect(src).toContain(fn);
    expect(src).toContain("const AUTH_KEY = 'K';");
    expect(src).toContain("if (!p || p.key !== AUTH_KEY) return out({ ok: false, error: 'unauthorized' });"); // checked before any event
    expect(src).toContain('function verifyFiles');
    expect(src).toContain('Utilities.DigestAlgorithm.SHA_256');
    expect(src).toMatch(/test\.ping.*getFolderById\(FOLDER_ID\)\.getName\(\).*openById\(SHEET_ID\)\.getName\(\)/); // the test really opens both
  });
});
