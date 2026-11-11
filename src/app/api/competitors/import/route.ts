import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { importCompetitorCsv } from '@/lib/competitors/service';
import { audit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
/** POST multipart (brandId, file) — Metricool CSV export of competitors or competitor posts (≤ 5 MB). */
export const POST = api('settings:integrations', async (req, { user }) => {
  const form = await req.formData();
  const brandId = String(form.get('brandId') ?? '');
  const file = form.get('file');
  if (!/^\d+$/.test(brandId)) throw new AppError('VALIDATION', 'اختر العلامة التجارية.', 422);
  if (!(file instanceof File)) throw new AppError('VALIDATION', 'أرفق ملف CSV.', 422);
  if (file.size > 5 * 1024 * 1024) throw new AppError('VALIDATION', 'الملف أكبر من 5MB.', 413);
  try {
    const r = await importCompetitorCsv(brandId, await file.text());
    await audit({ actorId: user.sub, actorLabel: user.email, action: 'competitors.csv_import', details: { brandId, ...r } });
    return NextResponse.json(r);
  } catch (e) { throw new AppError('CSV_INVALID', (e as Error).message, 422); }
});
