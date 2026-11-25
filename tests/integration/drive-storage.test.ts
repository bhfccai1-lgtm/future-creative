import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { setSecret } from '@/lib/settings';
import { storage } from '@/lib/storage';
import { generateAdvertisement } from '@/lib/pipeline/generate';
import { appsScriptSource, backfillArchive, driveFallback, offloadArchivedMedia, queueGoogleArchive, uploadBackupToDrive, uploadStreamToDrive } from '@/lib/integrations/google-archive';
import { deliverPending } from '@/lib/integrations/events';
import { captureQueues, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });
const URL_ = 'https://script.google.com/macros/s/AKfycbTESTTESTTESTTESTTEST/exec';

async function publishedAd(daysAgo: number) {
  const { accounts } = await seedBase();
  const { advertisement: ad } = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'IMAGE_FEED' });
  await prisma.advertisement.update({ where: { id: ad.id }, data: { state: 'PUBLISHED' } });
  const at = new Date(Date.now() - daysAgo * 86400_000);
  const job = await prisma.publicationJob.create({ data: { idempotencyKey: `k-${ad.id}`, advertisementId: ad.id, accountId: accounts[0].id, provider: 'metricool', state: 'PUBLISHED', scheduledFor: at } });
  await prisma.publicationResult.create({ data: { jobId: job.id, verifiedAt: at } });
  return prisma.advertisement.findUniqueOrThrow({ where: { id: ad.id }, include: { media: true } });
}
/** the script's answer: echoes every file with a Drive id and its real size */
const scriptAnswer = (sizeFix = 0) => (async (_u: string, init: { body: string }) => {
  const files = (JSON.parse(init.body).data.files as { mediaId: string; name: string; bytes: number }[]).map((f, i) => ({ mediaId: f.mediaId, name: f.name, id: `drive-${i}-${f.mediaId}`, size: f.bytes + sizeFix, url: `https://drive.google.com/file/d/drive-${i}/view` }));
  return new Response(JSON.stringify({ ok: true, version: 2, files }), { status: 200 });
}) as unknown as typeof fetch;

describe('Google Drive as cold storage', () => {
  it('the archive answer stores Drive ids; an ok:false answer is retried, not counted as delivered', async () => {
    const ad = await publishedAd(60);
    await setSecret('GOOGLE_ARCHIVE_URL', URL_, 't');
    await queueGoogleArchive(ad.id, null);
    const bad = await deliverPending((async () => new Response('{"ok":false,"error":"quota"}', { status: 200 })) as unknown as typeof fetch);
    expect(bad).toMatchObject({ delivered: 0, failed: 1 });
    expect((await prisma.webhookDelivery.findFirstOrThrow()).status).toBe('PENDING');
    await prisma.webhookDelivery.updateMany({ data: { nextAttemptAt: new Date(0) } });
    const ok = await deliverPending(scriptAnswer());
    expect(ok.delivered).toBe(1);
    const final = await prisma.mediaAsset.findFirstOrThrow({ where: { advertisementId: ad.id, role: 'FINAL' } });
    expect((final.meta as { drive?: { id: string; size: number } }).drive).toMatchObject({ size: final.bytes });
  });

  it('offload removes the server file ONLY when Drive confirms the same size AND SHA-256 at that moment; the dashboard then opens Drive', async () => {
    const ad = await publishedAd(60);
    await setSecret('GOOGLE_ARCHIVE_URL', URL_, 't');
    await queueGoogleArchive(ad.id, null); await deliverPending(scriptAnswer());
    const final = await prisma.mediaAsset.findFirstOrThrow({ where: { advertisementId: ad.id, role: 'FINAL' } });
    const driveId = (final.meta as { drive: { id: string } }).drive.id;
    const intact = async (ids: string[]) => ids.map((id) => ({ id, size: final.bytes, sha256: final.sha256 }));
    expect(await offloadArchivedMedia({ afterDays: 90, verify: intact })).toMatchObject({ removed: 0 }); // not old enough
    // any doubt keeps the file: a different fingerprint, a file missing on Drive, a script that cannot verify
    expect(await offloadArchivedMedia({ afterDays: 45, verify: async (ids) => ids.map((id) => ({ id, size: final.bytes, sha256: 'f'.repeat(64) })) })).toMatchObject({ removed: 0, mismatched: 1 });
    expect(await offloadArchivedMedia({ afterDays: 45, verify: async (ids) => ids.map((id) => ({ id, missing: true })) })).toMatchObject({ removed: 0, mismatched: 1 });
    expect(await offloadArchivedMedia({ afterDays: 45, verify: async () => { throw new Error('unknown event'); } })).toMatchObject({ removed: 0, blocked: 'unknown event' });
    expect(await storage().exists(final.storageKey)).toBe(true);
    const r = await offloadArchivedMedia({ afterDays: 45, verify: async (ids) => { expect(ids).toEqual([driveId]); return intact(ids); } });
    expect(r.removed).toBe(1); expect(r.freedBytes).toBe(final.bytes);
    expect(await storage().exists(final.storageKey)).toBe(false);
    expect(await driveFallback(final.storageKey)).toMatch(/^https:\/\/drive\.google\.com\/file\/d\/drive-0-/);
    const thumb = await prisma.mediaAsset.findFirst({ where: { advertisementId: ad.id, role: { notIn: ['FINAL', 'VIDEO', 'SLIDE'] } } });
    if (thumb) expect(await storage().exists(thumb.storageKey)).toBe(true); // layers / thumbnails stay
    expect((await offloadArchivedMedia({ afterDays: 45, verify: intact })).removed).toBe(0); // idempotent
    const after = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: final.id } });
    expect((after.meta as { verifiedSha256At?: string }).verifiedSha256At).toBeTruthy();
  });

  it('a server file that no longer matches its own recorded fingerprint is never removed', async () => {
    const ad = await publishedAd(60);
    await setSecret('GOOGLE_ARCHIVE_URL', URL_, 't');
    await queueGoogleArchive(ad.id, null); await deliverPending(scriptAnswer());
    const final = await prisma.mediaAsset.findFirstOrThrow({ where: { advertisementId: ad.id, role: 'FINAL' } });
    await storage().put(final.storageKey, Buffer.alloc(final.bytes, 7), final.mimeType); // same size, different content
    const r = await offloadArchivedMedia({ afterDays: 45, verify: async (ids) => ids.map((id) => ({ id, size: final.bytes, sha256: final.sha256 })) });
    expect(r).toMatchObject({ removed: 0, mismatched: 1 });
    expect(await storage().exists(final.storageKey)).toBe(true);
  });

  it('every request to the script carries the auth key (added at send time, never stored in the outbox)', async () => {
    const ad = await publishedAd(10);
    await setSecret('GOOGLE_ARCHIVE_URL', URL_, 't');
    await queueGoogleArchive(ad.id, null);
    const row = await prisma.webhookDelivery.findFirstOrThrow();
    expect(JSON.stringify(row.payload)).not.toMatch(/"key"/);
    let sentKey = '';
    await deliverPending((async (_u: string, init: { body: string }) => { sentKey = JSON.parse(init.body).key; return scriptAnswer()(_u, init as never); }) as unknown as typeof fetch);
    expect(sentKey).toMatch(/^[a-f0-9]{64}$/);
    const { archiveKey } = await import('@/lib/integrations/google-archive');
    expect(await archiveKey()).toBe(sentKey); // one stable key, stored encrypted
  });

  it('a size mismatch keeps the server file', async () => {
    const ad = await publishedAd(60);
    await setSecret('GOOGLE_ARCHIVE_URL', URL_, 't');
    await queueGoogleArchive(ad.id, null); await deliverPending(scriptAnswer(-5));
    const r = await offloadArchivedMedia({ afterDays: 45 });
    expect(r).toMatchObject({ removed: 0, skipped: 1 });
    const final = await prisma.mediaAsset.findFirstOrThrow({ where: { advertisementId: ad.id, role: 'FINAL' } });
    expect(await storage().exists(final.storageKey)).toBe(true);
  });

  it('backfill queues only designs without a Drive copy', async () => {
    const ad = await publishedAd(10);
    await setSecret('GOOGLE_ARCHIVE_URL', URL_, 't');
    expect((await backfillArchive()).queued).toBe(1);
    expect((await backfillArchive()).queued).toBe(0); // already pending
    await deliverPending(scriptAnswer());
    expect((await backfillArchive()).queued).toBe(0); // now on Drive
    void ad;
  });

  it('database backups go to Drive in ≤20 MB parts, each size verified', async () => {
    await seedBase();
    await setSecret('GOOGLE_ARCHIVE_URL', URL_, 't');
    const seen: { name: string; last: boolean; bytes: number }[] = [];
    const f = (async (_u: string, init: { body: string }) => {
      const d = JSON.parse(init.body).data; const bytes = Buffer.from(d.base64, 'base64').length;
      seen.push({ name: d.name, last: d.last, bytes });
      return new Response(JSON.stringify({ ok: true, id: `id-${seen.length}`, size: bytes }), { status: 200 });
    }) as unknown as typeof fetch;
    const data = Buffer.alloc(45 * 1024 * 1024, 7);
    const r = await uploadBackupToDrive(data, { backup: '20261119-020000', name: 'db.dump', fetchImpl: f });
    expect(r.parts.map((p) => p.name)).toEqual(['db.dump.part01', 'db.dump.part02', 'db.dump.part03']);
    expect(seen.map((x) => x.last)).toEqual([false, false, true]);
    expect(seen.reduce((a, x) => a + x.bytes, 0)).toBe(data.length);
    const wrong = (async () => new Response(JSON.stringify({ ok: true, id: 'x', size: 1 }), { status: 200 })) as unknown as typeof fetch;
    await expect(uploadBackupToDrive(Buffer.alloc(5000, 1), { backup: 'b', name: 'db.dump', fetchImpl: wrong })).rejects.toThrow(/size mismatch/);
  });

  it('large files are STREAMED to Drive part by part (never whole in memory); the final part carries «last»', async () => {
    await seedBase();
    await setSecret('GOOGLE_ARCHIVE_URL', URL_, 't');
    const seen: { name: string; last: boolean; bytes: number }[] = [];
    const f = (async (_u: string, init: { body: string }) => { const d = JSON.parse(init.body).data; const bytes = Buffer.from(d.base64, 'base64').length; seen.push({ name: d.name, last: d.last, bytes }); return new Response(JSON.stringify({ ok: true, id: `id${seen.length}`, size: bytes }), { status: 200 }); }) as unknown as typeof fetch;
    async function* chunks() { for (let i = 0; i < 45; i++) yield Buffer.alloc(1024 * 1024, i); } // 45 MB in 1 MB pieces
    const r = await uploadStreamToDrive(chunks(), { backup: '20261101-020000', name: 'media.tar.gz', fetchImpl: f });
    expect(r.bytes).toBe(45 * 1024 * 1024);
    expect(seen.map((x) => x.name)).toEqual(['media.tar.gz.part0001', 'media.tar.gz.part0002', 'media.tar.gz.part0003']);
    expect(seen.map((x) => x.last)).toEqual([false, false, true]);
    seen.length = 0;
    async function* small() { yield Buffer.alloc(5000, 1); }
    await uploadStreamToDrive(small(), { backup: 'b', name: 'db.dump', fetchImpl: f });
    expect(seen).toEqual([{ name: 'db.dump.part0001', last: true, bytes: 5000 }]);
  });

  it('the v2 script returns Drive ids and stores database backups', () => {
    const src = appsScriptSource({ folderId: 'F1', sheetId: 'S1', host: 'example.test', keepBackups: 12, key: 'K' });
    expect(src).toMatch(/const VERSION = [2-9];/); expect(src).toContain('const KEEP_BACKUPS = 12;');
    expect(src).toMatch(/file\.getId\(\)/); expect(src).toMatch(/function backupPart/);
  });
});
