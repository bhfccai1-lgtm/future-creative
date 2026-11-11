import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { audit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { applyProductImport, parseProductCsv, sheetsCsvUrl } from '@/lib/catalog/import';

/**
 * POST multipart: file (CSV) or url (Google Sheets link shared "anyone with the link"), dryRun=1 for a preview.
 * Upserts by slug — importing the same sheet again updates instead of duplicating.
 */
export const POST = api('products:manage', async (req, { user }) => {
  const form = await req.formData();
  const dryRun = String(form.get('dryRun') ?? '') === '1';
  const file = form.get('file');
  const url = String(form.get('url') ?? '').trim();
  let text: string;
  if (file instanceof File && file.size) {
    if (file.size > 10 * 1024 * 1024) throw new AppError('VALIDATION', 'الملف أكبر من 10MB.', 413);
    text = await file.text();
  } else if (url) {
    const csvUrl = sheetsCsvUrl(url);
    if (!csvUrl) throw new AppError('VALIDATION', 'الرابط ليس رابط Google Sheets صحيحًا.', 422);
    const r = await fetch(csvUrl, { redirect: 'follow', signal: AbortSignal.timeout(20_000) }).catch((e) => { throw new AppError('NETWORK', `تعذر تحميل الجدول: ${(e as Error).message}`, 502); });
    const ct = r.headers.get('content-type') ?? '';
    if (!r.ok || ct.includes('text/html')) throw new AppError('SHEET_PRIVATE', 'تعذر قراءة الجدول — شاركه «لأي شخص لديه الرابط (عارض)» ثم أعد المحاولة.', 422);
    text = await r.text();
  } else throw new AppError('VALIDATION', 'أرفق ملف CSV أو ضع رابط Google Sheets.', 422);
  const { rows, errors } = parseProductCsv(text);
  if (rows.length > 5000) throw new AppError('VALIDATION', 'الحد الأقصى 5000 منتج في الاستيراد الواحد.', 422);
  const summary = await applyProductImport(rows, { dryRun, actor: user.email });
  if (!dryRun) await audit({ actorId: user.sub, actorLabel: user.email, action: 'products.import', details: { ...summary, errors: errors.length, source: url ? 'google-sheets' : 'csv' } });
  return NextResponse.json({ dryRun, ...summary, errors: errors.slice(0, 50), errorCount: errors.length, sample: rows.slice(0, 5).map((r) => ({ line: r.line, slug: r.slug, category: r.category, titleAr: r.titleAr, titleEn: r.titleEn })) });
});
