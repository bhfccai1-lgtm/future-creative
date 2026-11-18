import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { AppError } from '@/lib/errors';
import { uploadPrintAsset } from '@/lib/print/service';
import { printUser } from '../../../_user';
type P = { params: Promise<{ id: string }> };
/** client logo (stored as the original file — never regenerated) or the supplier's dieline */
export const POST = api<P>('ads:create', async (req, { params, user }) => {
  const form = await req.formData(); const file = form.get('file'); const kind = String(form.get('kind') ?? 'logo');
  if (!(file instanceof File)) throw new AppError('NO_FILE', 'أرفق الملف.', 422);
  if (file.size > 15 * 1024 * 1024) throw new AppError('TOO_BIG', 'الحد الأقصى 15 ميغابايت.', 413);
  if (kind !== 'logo' && kind !== 'dieline') throw new AppError('BAD_KIND', 'نوع غير معروف.', 422);
  return NextResponse.json({ ok: true, project: await uploadPrintAsset((await params).id, kind, Buffer.from(await file.arrayBuffer()), printUser(user)) });
});
