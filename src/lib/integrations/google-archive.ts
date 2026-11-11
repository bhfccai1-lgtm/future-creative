import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
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
    const files = publishableMedia(ad).map((m, i) => ({ name: `${ad.account.name}-${ad.id}-${String(i + 1).padStart(2, '0')}.${m.storageKey.split('.').pop()}`, url: signedMediaUrl(m.storageKey, 3 * 24 * 3600), mime: m.mimeType }));
    const payload = {
      id: randomUUID(), event: 'archive.google', occurredAt: new Date().toISOString(),
      data: { adId: ad.id, account: ad.account.name, format: ad.format, product: ad.product.titleAr, headline: ad.headline ?? ad.product.titleAr, caption: ad.caption ?? '', publicUrl, publishedAt: new Date().toISOString(), files },
    };
    return await prisma.webhookDelivery.create({ data: { event: 'archive.google', payload: payload as Prisma.InputJsonValue, target } });
  } catch (e) { log.warn('google_archive.queue_failed', { adId, error: (e as Error).message }); return null; }
}

/** The Apps Script the owner deploys as a web app. Folder/sheet ids and the system host are filled in. */
export function appsScriptSource(o: { folderId: string; sheetId: string; host: string }) {
  return `// Future Creative — archive of published posts (Google Drive + Sheets). Deploy: Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
const FOLDER_ID = '${o.folderId}';
const SHEET_ID = '${o.sheetId}';
const ALLOWED_HOST = '${o.host}'; // files are only downloaded from your system

function doPost(e) {
  try {
    const p = JSON.parse(e.postData.contents);
    if (p.event !== 'archive.google' && p.event !== 'test.ping') return out({ ok: false, error: 'unknown event' });
    if (p.event === 'test.ping') return out({ ok: true, test: true });
    const d = p.data || {};
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('published');
    const ids = sheet.getRange(1, 7, Math.max(1, sheet.getLastRow()), 1).getValues().map(function (r) { return String(r[0]); });
    if (ids.indexOf(String(d.adId)) >= 0) return out({ ok: true, duplicate: true }); // retries never duplicate
    const root = DriveApp.getFolderById(FOLDER_ID);
    const it = root.getFoldersByName(d.account || 'other');
    const folder = it.hasNext() ? it.next() : root.createFolder(d.account || 'other');
    const links = [];
    (d.files || []).forEach(function (f) {
      if (String(f.url).indexOf('https://' + ALLOWED_HOST + '/') !== 0) return;
      const blob = UrlFetchApp.fetch(f.url, { muteHttpExceptions: false }).getBlob().setName(f.name);
      links.push(folder.createFile(blob).getUrl());
    });
    if (d.caption) folder.createFile(String(d.adId) + '-caption.txt', d.caption, MimeType.PLAIN_TEXT);
    sheet.appendRow([d.publishedAt, d.account, d.format, d.headline, d.publicUrl || '', links[0] || '', d.adId, d.product || '', links.length]);
    return out({ ok: true, files: links.length });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
`;
}
