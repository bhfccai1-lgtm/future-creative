import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { getSecret, getSettings, secretStatus, setSecret, updateSettings } from '@/lib/settings';
import { audit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { SCRIPT_VERSION, appsScriptSource, archiveKey, googleIdFrom, withKey } from '@/lib/integrations/google-archive';

const BAD_FOLDER = 'رابط مجلد Drive غير صحيح — انسخه من شريط العنوان وهو داخل المجلد (…/folders/…).';
const BAD_SHEET = 'رابط جدول Sheets غير صحيح — انسخه من شريط العنوان (…/spreadsheets/d/…).';
const folderUrl = (id: string) => (id ? `https://drive.google.com/drive/folders/${id}` : '');
const sheetUrl = (id: string) => (id ? `https://docs.google.com/spreadsheets/d/${id}` : '');

/** What is saved (read back from the database): folder + sheet links, whether the script link is set, the last test. */
async function status() {
  const g = (await getSettings()).googleArchive;
  return { folderUrl: folderUrl(g.folderId), sheetUrl: sheetUrl(g.sheetId), configured: (await secretStatus('GOOGLE_ARCHIVE_URL')).configured, lastTest: g.lastTest, latestVersion: SCRIPT_VERSION };
}

const Body = z.union([
  z.object({ url: z.string().max(500) }),
  z.object({ folder: z.string().max(500), sheet: z.string().max(500) }),
]);
/**
 * PUT { folder, sheet } → validates and saves the archive folder + sheet links.
 * PUT { url } → saves (encrypted) the Apps Script web-app link; "__delete__" removes it.
 * The answer is re-read from the database, so «saved» is only shown once it really is.
 */
export const PUT = api('settings:integrations', async (req, { user }) => {
  const b = Body.parse(await req.json());
  if ('folder' in b) {
    const folderId = googleIdFrom(b.folder, 'folder'), sheetId = googleIdFrom(b.sheet, 'sheet');
    if (!folderId) throw new AppError('VALIDATION', BAD_FOLDER, 422);
    if (!sheetId) throw new AppError('VALIDATION', BAD_SHEET, 422);
    await updateSettings((s) => ({ ...s, googleArchive: { ...s.googleArchive, folderId, sheetId } }), user.email);
    const st = await status();
    if (st.folderUrl !== folderUrl(folderId) || st.sheetUrl !== sheetUrl(sheetId)) throw new AppError('NOT_SAVED', 'لم يتأكد الحفظ في قاعدة البيانات — أعد المحاولة.', 500);
    await audit({ actorId: user.sub, actorLabel: user.email, action: 'settings.google_archive.links', details: { folderId, sheetId } });
    return NextResponse.json({ saved: true, ...st });
  }
  const url = b.url.trim();
  if (url === '__delete__') await setSecret('GOOGLE_ARCHIVE_URL', null, user.email);
  else {
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]{20,}\/exec$/.test(url)) throw new AppError('VALIDATION', 'الرابط يجب أن يكون رابط تطبيق ويب من Apps Script وينتهي بـ /exec (وليس /dev).', 422);
    await setSecret('GOOGLE_ARCHIVE_URL', url, user.email);
    if ((await getSecret('GOOGLE_ARCHIVE_URL')) !== url) throw new AppError('NOT_SAVED', 'لم يتأكد الحفظ في قاعدة البيانات — أعد المحاولة.', 500);
  }
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'settings.google_archive.update', details: { configured: url !== '__delete__' } });
  return NextResponse.json({ saved: true, ...(await status()) });
});

/**
 * Test: the script must answer with its version AND open the archive folder + sheet (v4), which proves the link, the
 * key and the access. The result is stored and shown on the page. { backfill: true } archives what was never archived.
 */
export const POST = api('settings:integrations', async (req) => {
  const url = await getSecret('GOOGLE_ARCHIVE_URL');
  if (!url) throw new AppError('NOT_CONFIGURED', 'احفظ رابط السكربت أولًا.', 412);
  const { backfill } = z.object({ backfill: z.boolean().default(false) }).parse(await req.json().catch(() => ({})));
  if (backfill) {
    const { backfillArchive } = await import('@/lib/integrations/google-archive');
    return NextResponse.json({ ok: true, ...(await backfillArchive(200)) });
  }
  const saved = (await getSettings()).googleArchive;
  const record = async (t: { ok: boolean; message: string; version?: number | null; folderName?: string | null; sheetName?: string | null }) => {
    const lastTest = { at: new Date().toISOString(), ok: t.ok, message: t.message.slice(0, 400), version: t.version ?? null, folderName: t.folderName ?? null, sheetName: t.sheetName ?? null };
    await updateSettings((s) => ({ ...s, googleArchive: { ...s.googleArchive, lastTest } }), 'system');
    return lastTest;
  };
  let j: { ok?: boolean; error?: string; version?: number; folder?: string; sheet?: string; folderId?: string; sheetId?: string } | null = null;
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(await withKey({ event: 'test.ping' })), signal: AbortSignal.timeout(30_000) });
    j = await r.json().catch(() => null);
  } catch (e) {
    const t = await record({ ok: false, message: `تعذر الوصول للسكربت: ${(e as Error).message}` });
    throw new AppError('NETWORK', t.message, 502);
  }
  if (!j) { const t = await record({ ok: false, message: 'السكربت لم يرجع JSON — تأكد أن النشر «Web app» و«Who has access: Anyone»، وأن الرابط ينتهي بـ /exec.' }); throw new AppError('SCRIPT', t.message, 502); }
  if (!j.ok && j.error === 'unauthorized') { const t = await record({ ok: false, message: 'السكربت رفض مفتاح المصادقة — أنشئ السكربت من جديد من هذه الصفحة والصقه مكان القديم ثم Deploy → New version.' }); throw new AppError('SCRIPT', t.message, 502); }
  if (!j.ok) { const t = await record({ ok: false, message: `السكربت رد بخطأ: ${j.error ?? 'غير معروف'}` }); throw new AppError('SCRIPT', t.message, 502); }
  const version = j.version ?? 1;
  // v4 opens the folder and the sheet: names prove the access; ids must match the saved links
  const mismatch = j.folderId && saved.folderId && (j.folderId !== saved.folderId || j.sheetId !== saved.sheetId);
  const message = version < SCRIPT_VERSION
    ? `السكربت يعمل لكنه الإصدار ${version} — أنشئ السكربت الجديد (الإصدار ${SCRIPT_VERSION}) والصقه مكان القديم ثم Deploy → Manage deployments → Edit → New version.`
    : mismatch ? 'السكربت يعمل لكنه مصنوع لمجلد/جدول غير المحفوظ هنا — أنشئ السكربت من جديد بالروابط المحفوظة.'
    : `متصل ✓ — الإصدار ${version} · المجلد «${j.folder}» · الجدول «${j.sheet}»`;
  const t = await record({ ok: version >= SCRIPT_VERSION && !mismatch, message, version, folderName: j.folder ?? null, sheetName: j.sheet ?? null });
  return NextResponse.json({ ok: true, version, outdated: version < SCRIPT_VERSION, mismatch: !!mismatch, lastTest: t });
});

/**
 * GET → the saved state (links read back from the database, last test, script version).
 * GET ?script=1 → the ready-to-paste Apps Script for the SAVED folder + sheet, with this system's host and auth key.
 */
export const GET = api('settings:integrations', async (req) => {
  const q = new URL(req.url).searchParams;
  if (!q.get('script')) return NextResponse.json(await status());
  const s = await getSettings();
  const { folderId, sheetId } = s.googleArchive;
  if (!folderId || !sheetId) throw new AppError('VALIDATION', 'احفظ رابط المجلد ورابط الجدول أولًا.', 422);
  const host = process.env.DOMAIN || new URL(req.url).host;
  return NextResponse.json({ script: appsScriptSource({ folderId, sheetId, host, keepBackups: s.storage.keepDriveBackups, key: await archiveKey() }) });
});
