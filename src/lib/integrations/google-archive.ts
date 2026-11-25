import type { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '../db';
import { getSecret } from '../settings';
import { signedMediaUrl } from '../storage';
import { publishableMedia } from '../publishing/media';
import { log } from '../ops/log';

/**
 * Direct Google Drive + Sheets archive through the owner's own Google Apps Script web app
 * (no n8n, no Google Cloud project). Each verified publication is queued in the durable webhook outbox
 * (same retries) with signed, time-limited links to the exact published files; the script saves them
 * to the archive folder and appends a row to the «published» sheet.
 */
export async function queueGoogleArchive(adId: string, publicUrl: string | null) {
  try {
    const target = await getSecret('GOOGLE_ARCHIVE_URL');
    if (!target) return null;
    const ad = await prisma.advertisement.findUnique({ where: { id: adId }, include: { media: true, account: true, product: true } });
    if (!ad) return null;
    const files = publishableMedia(ad).map((m, i) => ({ name: `${ad.account.name}-${ad.id}-${String(i + 1).padStart(2, '0')}.${m.storageKey.split('.').pop()}`, url: signedMediaUrl(m.storageKey, 3 * 24 * 3600), mime: m.mimeType, mediaId: m.id, bytes: m.bytes }));
    const payload = {
      id: randomUUID(), event: 'archive.google', occurredAt: new Date().toISOString(),
      data: { adId: ad.id, account: ad.account.name, format: ad.format, product: ad.product.titleAr, headline: ad.headline ?? ad.product.titleAr, caption: ad.caption ?? '', publicUrl, publishedAt: new Date().toISOString(), files },
    };
    return await prisma.webhookDelivery.create({ data: { event: 'archive.google', payload: payload as Prisma.InputJsonValue, target } });
  } catch (e) { log.warn('google_archive.queue_failed', { adId, error: (e as Error).message }); return null; }
}

/**
 * v2: Drive id + size of every saved file; v3: smart Drive; v4: an auth key on every request, the SHA-256 of every
 * saved file, «verify.files» (size + SHA-256 of Drive files right before a local copy may be removed) and a test that
 * really opens the archive folder and sheet.
 */
export const SCRIPT_VERSION = 4;

export const sha256Hex = (b: Buffer | Uint8Array) => createHash('sha256').update(b).digest('hex');

/** The shared key the script checks on every request (created once, stored encrypted). */
export async function archiveKey(): Promise<string> {
  const { setSecret } = await import('../settings');
  const k = await getSecret('GOOGLE_ARCHIVE_KEY');
  if (k) return k;
  const fresh = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
  await setSecret('GOOGLE_ARCHIVE_KEY', fresh, 'system');
  return fresh;
}
/** every request to the script carries the key */
export const withKey = async <T extends object>(body: T) => ({ ...body, key: await archiveKey() });

/** The Apps Script the owner deploys as a web app. Folder/sheet ids and the system host are filled in. */
export function appsScriptSource(o: { folderId: string; sheetId: string; host: string; keepBackups?: number; key: string }) {
  return `// Future Creative — archive of published posts (Google Drive + Sheets). Deploy: Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
const FOLDER_ID = '${o.folderId}';
const SHEET_ID = '${o.sheetId}';
const ALLOWED_HOST = '${o.host}'; // files are only downloaded from your system
const VERSION = ${SCRIPT_VERSION};
const KEEP_BACKUPS = ${o.keepBackups ?? 30};
const AUTH_KEY = '${o.key}'; // only your system knows this key — requests without it are refused

function doPost(e) {
  try {
    const p = JSON.parse(e.postData.contents);
    if (!p || p.key !== AUTH_KEY) return out({ ok: false, error: 'unauthorized' });
    if (p.event === 'test.ping') return out({ ok: true, test: true, version: VERSION, folderId: FOLDER_ID, sheetId: SHEET_ID, folder: DriveApp.getFolderById(FOLDER_ID).getName(), sheet: SpreadsheetApp.openById(SHEET_ID).getName() });
    if (p.event === 'verify.files') return verifyFiles(p.data || {});
    if (p.event === 'backup.part') return backupPart(p.data || {});
    if (p.event === 'metrics.update') return metricsUpdate(p.data || {});
    if (p.event === 'best.copy') return bestCopy(p.data || {});
    if (p.event === 'report.doc') return reportDoc(p.data || {});
    if (p.event !== 'archive.google') return out({ ok: false, error: 'unknown event' });
    const d = p.data || {};
    const ss = SpreadsheetApp.openById(SHEET_ID);
    let sheet = ss.getSheetByName('published');
    if (!sheet) { sheet = ss.insertSheet('published'); sheet.appendRow(['تاريخ النشر', 'الحساب', 'الصيغة', 'العنوان', 'رابط المنشور', 'رابط الملف', 'رقم التصميم', 'المنتج', 'عدد الملفات']); }
    const ids = sheet.getRange(1, 7, Math.max(1, sheet.getLastRow()), 1).getValues().map(function (r) { return String(r[0]); });
    if (ids.indexOf(String(d.adId)) >= 0) return out({ ok: true, duplicate: true }); // retries never duplicate
    const root = DriveApp.getFolderById(FOLDER_ID);
    const it = root.getFoldersByName(d.account || 'other');
    const folder = it.hasNext() ? it.next() : root.createFolder(d.account || 'other');
    const links = []; const saved = [];
    (d.files || []).forEach(function (f) {
      if (String(f.url).indexOf('https://' + ALLOWED_HOST + '/') !== 0) return;
      const blob = UrlFetchApp.fetch(f.url, { muteHttpExceptions: false }).getBlob().setName(f.name);
      const file = folder.createFile(blob);
      links.push(file.getUrl());
      saved.push({ mediaId: f.mediaId || null, name: f.name, id: file.getId(), size: file.getSize(), url: file.getUrl(), sha256: sha(file.getBlob().getBytes()) });
    });
    if (d.caption) folder.createFile(String(d.adId) + '-caption.txt', d.caption, MimeType.PLAIN_TEXT);
    sheet.appendRow([d.publishedAt, d.account, d.format, d.headline, d.publicUrl || '', links[0] || '', d.adId, d.product || '', links.length]);
    return out({ ok: true, version: VERSION, files: saved });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}
// database backups: one file per part in <archive folder>/backups/<backup name>/, older backups pruned (keep KEEP_BACKUPS)
function backupPart(d) {
  const root = DriveApp.getFolderById(FOLDER_ID);
  const bi = root.getFoldersByName('backups');
  const backups = bi.hasNext() ? bi.next() : root.createFolder('backups');
  const fi = backups.getFoldersByName(d.backup);
  const folder = fi.hasNext() ? fi.next() : backups.createFolder(d.backup);
  const existing = folder.getFilesByName(d.name);
  if (existing.hasNext()) { const f = existing.next(); return out({ ok: true, duplicate: true, id: f.getId(), size: f.getSize(), sha256: sha(f.getBlob().getBytes()) }); }
  const bytes = Utilities.base64Decode(d.base64);
  const file = folder.createFile(Utilities.newBlob(bytes, 'application/octet-stream', d.name));
  const digest = sha(bytes);
  if (d.last) {
    const all = []; const it = backups.getFolders(); while (it.hasNext()) all.push(it.next());
    all.sort(function (a, b) { return b.getName() < a.getName() ? -1 : 1; });
    all.slice(KEEP_BACKUPS).forEach(function (f) { f.setTrashed(true); });
  }
  return out({ ok: true, id: file.getId(), size: file.getSize(), sha256: digest });
}
// v4 — integrity check right before the system removes its own copy: size + SHA-256 of each Drive file
function verifyFiles(d) {
  const files = (d.ids || []).map(function (id) {
    try { const f = DriveApp.getFileById(id); if (f.isTrashed()) return { id: id, missing: true }; return { id: id, size: f.getSize(), sha256: sha(f.getBlob().getBytes()) }; }
    catch (err) { return { id: id, missing: true }; }
  });
  return out({ ok: true, files: files });
}
function sha(bytes) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes).map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join(''); }
// v3 — live performance columns in the «published» sheet (matched by design id, column G)
var METRIC_HEADERS = ['المشاهدات', 'الوصول', 'الحفظ', 'المشاركات', 'التعليقات', 'الإكمال٪', 'التخطي٪', 'درجة الأداء', 'آخر تحديث'];
function metricsUpdate(d) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('published');
  if (!sheet) return out({ ok: true, updated: 0 });
  sheet.getRange(1, 10, 1, METRIC_HEADERS.length).setValues([METRIC_HEADERS]);
  const last = sheet.getLastRow(); if (last < 2) return out({ ok: true, updated: 0 });
  const ids = sheet.getRange(2, 7, last - 1, 1).getValues().map(function (r) { return String(r[0]); });
  let n = 0;
  (d.rows || []).forEach(function (r) {
    const i = ids.indexOf(String(r.adId)); if (i < 0) return;
    sheet.getRange(i + 2, 10, 1, METRIC_HEADERS.length).setValues([[r.views, r.reach, r.saves, r.shares, r.comments, r.retention === null ? '' : r.retention, r.skip === null ? '' : r.skip, r.score, d.at || '']]);
    n++;
  });
  return out({ ok: true, updated: n });
}
// v3 — «⭐ أفضل التصاميم»: a copy of the best performers per account (an always-ready portfolio to share)
function bestCopy(d) {
  const root = DriveApp.getFolderById(FOLDER_ID);
  const bi = root.getFoldersByName('⭐ أفضل التصاميم');
  const best = bi.hasNext() ? bi.next() : root.createFolder('⭐ أفضل التصاميم');
  const ai = best.getFoldersByName(d.account || 'other');
  const folder = ai.hasNext() ? ai.next() : best.createFolder(d.account || 'other');
  const copied = [];
  (d.fileIds || []).forEach(function (id) {
    const f = DriveApp.getFileById(id);
    const name = (d.prefix ? d.prefix + ' — ' : '') + f.getName();
    if (folder.getFilesByName(name).hasNext()) return;
    copied.push(f.makeCopy(name, folder).getId());
  });
  return out({ ok: true, copied: copied.length, folderUrl: folder.getUrl() });
}
// v3 — the monthly smart report as a Google Doc in «التقارير»
function reportDoc(d) {
  const root = DriveApp.getFolderById(FOLDER_ID);
  const ri = root.getFoldersByName('التقارير');
  const reports = ri.hasNext() ? ri.next() : root.createFolder('التقارير');
  const ex = reports.getFilesByName(d.title); if (ex.hasNext()) ex.next().setTrashed(true);
  const doc = DocumentApp.create(d.title);
  const body = doc.getBody();
  body.setAttributes({ [DocumentApp.Attribute.FONT_FAMILY]: 'Tajawal' });
  (d.blocks || []).forEach(function (b) {
    const p = b.type === 'h1' ? body.appendParagraph(b.text).setHeading(DocumentApp.ParagraphHeading.HEADING1)
      : b.type === 'h2' ? body.appendParagraph(b.text).setHeading(DocumentApp.ParagraphHeading.HEADING2)
      : b.type === 'li' ? body.appendListItem(b.text) : body.appendParagraph(b.text);
    p.setLeftToRight(false).setAlignment(DocumentApp.HorizontalAlignment.RIGHT);
  });
  doc.saveAndClose();
  const file = DriveApp.getFileById(doc.getId()); file.moveTo(reports);
  return out({ ok: true, id: file.getId(), url: file.getUrl() });
}
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
`;
}

/** Folder / spreadsheet id from a pasted Google link (or the bare id). */
export function googleIdFrom(input: string, kind: 'folder' | 'sheet'): string | null {
  const t = input.trim();
  const m = kind === 'folder' ? t.match(/\/folders\/([\w-]{15,})/) : t.match(/\/spreadsheets\/d\/([\w-]{15,})/);
  if (m) return m[1];
  return /^[\w-]{15,}$/.test(t) ? t : null;
}


type Saved = { mediaId?: string | null; name: string; id: string; size: number; url: string; sha256?: string };
/** the script's answer for one archived design: the Drive id + size of each file is stored on its media row */
export async function recordArchiveResult(json: unknown) {
  const files = ((json as { files?: unknown })?.files ?? []) as Saved[];
  if (!Array.isArray(files)) return 0;
  let n = 0;
  for (const f of files) {
    if (!f?.mediaId || !f.id) continue;
    const m = await prisma.mediaAsset.findUnique({ where: { id: f.mediaId } });
    if (!m) continue;
    await prisma.mediaAsset.update({ where: { id: m.id }, data: { meta: { ...((m.meta as Record<string, unknown> | null) ?? {}), drive: { id: f.id, size: f.size, url: f.url, at: new Date().toISOString(), ...(f.sha256 ? { sha256: f.sha256 } : {}) } } as Prisma.InputJsonValue } });
    n++;
  }
  return n;
}

export type DriveMeta = { drive?: { id: string; size: number; url: string; at: string; sha256?: string }; offloadedAt?: string };
/** first filter (no network): Drive reported a copy of exactly the same size when it archived the file */
export const driveConfirmed = (m: { bytes: number; meta: unknown }) => { const d = (m.meta as DriveMeta | null)?.drive; return !!d?.id && d.size === m.bytes; };

export type DriveCheck = { id: string; size?: number; sha256?: string; missing?: boolean };
/** asks the script (v4) for the size + SHA-256 of Drive files RIGHT NOW (batches of 20) */
export async function verifyOnDrive(ids: string[], fetchImpl: typeof fetch = fetch): Promise<DriveCheck[]> {
  const target = await archiveTarget();
  const out: DriveCheck[] = [];
  for (let i = 0; i < ids.length; i += 20) {
    const r = await fetchImpl(target, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(await withKey({ event: 'verify.files', data: { ids: ids.slice(i, i + 20) } })), signal: AbortSignal.timeout(300_000) });
    const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string; files?: DriveCheck[] } | null;
    if (!j?.ok || !Array.isArray(j.files)) throw new Error(`verify.files: ${j?.error ?? 'no JSON answer'} — the script must be version ${SCRIPT_VERSION}`);
    out.push(...j.files);
  }
  return out;
}

/**
 * FREE SERVER SPACE: files of designs PUBLISHED more than `afterDays` days ago are removed from the server ONLY when
 *  1) Drive holds the file right now (checked through the script at this moment, not from an old answer),
 *  2) the Drive copy has exactly the same size AND the same SHA-256 as the file's recorded fingerprint, and
 *  3) the server's own file still matches that fingerprint (so the record is trustworthy).
 * Any doubt → the file stays. Thumbnails, drafts, print and education files are never touched.
 */
export async function offloadArchivedMedia(opts: { afterDays: number; now?: Date; limit?: number; verify?: (ids: string[]) => Promise<DriveCheck[]> }) {
  const { storage } = await import('../storage');
  const cutoff = new Date((opts.now ?? new Date()).getTime() - opts.afterDays * 86400_000);
  const rows = await prisma.mediaAsset.findMany({
    where: { role: { in: ['FINAL', 'VIDEO', 'SLIDE'] }, advertisement: { state: 'PUBLISHED', jobs: { some: { primary: true, result: { verifiedAt: { lt: cutoff } } } } } },
    take: opts.limit ?? 500, orderBy: { createdAt: 'asc' },
  });
  const candidates = rows.filter((m) => !((m.meta as DriveMeta | null) ?? {}).offloadedAt);
  let removed = 0, freed = 0, skipped = 0;
  const ready = candidates.filter((m) => driveConfirmed(m) && !!m.sha256);
  skipped += candidates.length - ready.length;
  if (!ready.length) return { removed, freedBytes: freed, skipped, mismatched: 0 };
  let checks: DriveCheck[];
  try { checks = await (opts.verify ?? verifyOnDrive)(ready.map((m) => (m.meta as DriveMeta).drive!.id)); }
  catch (e) { log.warn('drive_offload.verify_unavailable', { error: (e as Error).message }); return { removed, freedBytes: freed, skipped: skipped + ready.length, mismatched: 0, blocked: (e as Error).message }; }
  const byId = new Map(checks.map((c) => [c.id, c]));
  let mismatched = 0;
  for (const m of ready) {
    const meta = (m.meta as DriveMeta) ?? {};
    const c = byId.get(meta.drive!.id);
    if (!c || c.missing || c.size !== m.bytes || !c.sha256 || c.sha256 !== m.sha256) { mismatched++; skipped++; continue; }
    let local: Buffer;
    try { local = await storage().get(m.storageKey); } catch { skipped++; continue; }
    if (sha256Hex(local) !== m.sha256) { mismatched++; skipped++; continue; } // the server file is not what was recorded
    try { await storage().remove(m.storageKey); } catch { skipped++; continue; }
    await prisma.mediaAsset.update({ where: { id: m.id }, data: { meta: { ...meta, drive: { ...meta.drive!, sha256: c.sha256 }, offloadedAt: new Date().toISOString(), verifiedSha256At: new Date().toISOString() } as Prisma.InputJsonValue } });
    removed++; freed += m.bytes;
  }
  if (removed || mismatched) log.info('drive_offload.done', { removed, freedMb: Math.round(freed / 1e6), skipped, mismatched });
  return { removed, freedBytes: freed, skipped, mismatched };
}

/** archive published designs that were never archived (or archived by the v1 script without Drive ids) */
export async function backfillArchive(limit = 200) {
  const jobs = await prisma.publicationJob.findMany({
    where: { state: 'PUBLISHED', primary: true, advertisement: { media: { some: { role: { in: ['FINAL', 'VIDEO', 'SLIDE'] } } } } },
    include: { result: true, advertisement: { include: { media: true } } }, orderBy: { updatedAt: 'desc' }, take: 2000,
  });
  const pending = new Set((await prisma.webhookDelivery.findMany({ where: { event: 'archive.google', status: 'PENDING' }, select: { payload: true } })).map((d) => (d.payload as { data?: { adId?: string } }).data?.adId));
  let queued = 0;
  for (const j of jobs) {
    if (queued >= limit) break;
    const files = j.advertisement.media.filter((m) => ['FINAL', 'VIDEO', 'SLIDE'].includes(m.role));
    if (files.every((m) => (m.meta as DriveMeta | null)?.drive?.id) || pending.has(j.advertisementId)) continue;
    if (await queueGoogleArchive(j.advertisementId, j.result?.publicUrl ?? null)) queued++;
  }
  return { queued };
}

const PART = 20 * 1024 * 1024;
/** one part of a backup file → Drive (3 attempts), its size verified */
export async function uploadBackupPart(target: string, p: { backup: string; name: string; chunk: Buffer; last: boolean }, fetchImpl: typeof fetch = fetch) {
  const body = JSON.stringify(await withKey({ event: 'backup.part', data: { backup: p.backup, name: p.name, base64: p.chunk.toString('base64'), last: p.last } }));
  let j: { ok?: boolean; id?: string; size?: number; sha256?: string; error?: string } | null = null;
  for (let attempt = 1; attempt <= 3 && !j?.ok; attempt++) {
    try { const r = await fetchImpl(target, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(300_000) }); j = await r.json().catch(() => null); }
    catch (e) { j = { ok: false, error: (e as Error).message }; }
  }
  if (!j?.ok || !j.id) throw new Error(`Drive upload failed for ${p.name}: ${j?.error ?? 'no answer'} — is the script updated to version ${SCRIPT_VERSION}?`);
  if (j.size !== p.chunk.length) throw new Error(`Drive size mismatch for ${p.name}: ${j.size} ≠ ${p.chunk.length}`);
  // v4: the Drive copy's SHA-256 must equal the bytes we sent
  if (j.sha256 && j.sha256 !== sha256Hex(p.chunk)) throw new Error(`Drive SHA-256 mismatch for ${p.name}`);
  return { name: p.name, id: j.id, size: j.size, sha256: j.sha256 ?? null };
}
async function archiveTarget() {
  const target = await getSecret('GOOGLE_ARCHIVE_URL');
  if (!target) throw new Error('GOOGLE_ARCHIVE_URL is not set — connect the Google archive first (Settings → Integrations).');
  return target;
}

/** DATABASE BACKUP → Google Drive through the same script, in parts of at most 20 MB (Apps Script request limit) */
export async function uploadBackupToDrive(data: Buffer, opts: { backup: string; name: string; fetchImpl?: typeof fetch }) {
  const target = await archiveTarget();
  const parts = Math.max(1, Math.ceil(data.length / PART));
  const out: { name: string; id: string; size: number }[] = [];
  for (let i = 0; i < parts; i++) {
    const name = parts === 1 ? opts.name : `${opts.name}.part${String(i + 1).padStart(2, '0')}`;
    out.push(await uploadBackupPart(target, { backup: opts.backup, name, chunk: data.subarray(i * PART, (i + 1) * PART), last: i === parts - 1 }, opts.fetchImpl));
  }
  return { parts: out, bytes: data.length };
}

/**
 * Large files (a media archive of several GB) streamed to Drive part by part — never held in memory whole.
 * Parts are named <name>.part0001…; join them in order to restore (cat name.part* > name).
 */
export async function uploadStreamToDrive(stream: AsyncIterable<Buffer | Uint8Array>, opts: { backup: string; name: string; fetchImpl?: typeof fetch }) {
  const target = await archiveTarget();
  let buf = Buffer.alloc(0), pending: Buffer | null = null, n = 0, bytes = 0;
  const out: { name: string; id: string; size: number }[] = [];
  const send = async (chunk: Buffer, last: boolean) => { n++; out.push(await uploadBackupPart(target, { backup: opts.backup, name: `${opts.name}.part${String(n).padStart(4, '0')}`, chunk, last }, opts.fetchImpl)); };
  for await (const c of stream) {
    buf = Buffer.concat([buf, Buffer.from(c)]); bytes += c.length;
    while (buf.length >= PART) {
      if (pending) await send(pending, false); // one part is held back so the final part can carry «last»
      pending = buf.subarray(0, PART); buf = buf.subarray(PART);
    }
  }
  if (buf.length) { if (pending) await send(pending, false); pending = buf; }
  if (pending) await send(pending, true);
  return { parts: out, bytes };
}

/** a file that was moved to Google Drive: where the dashboard sends the viewer instead (null = not offloaded) */
export async function driveFallback(storageKey: string) {
  const m = await prisma.mediaAsset.findUnique({ where: { storageKey }, select: { meta: true } });
  const meta = (m?.meta as DriveMeta | null) ?? null;
  return meta?.offloadedAt && meta.drive?.id ? `https://drive.google.com/file/d/${meta.drive.id}/view` : null;
}
