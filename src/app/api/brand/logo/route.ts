import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { uploadLogo } from '@/lib/brand/logo';
import { getBusiness } from '@/lib/business';
import { audit } from '@/lib/audit';
import { AppError } from '@/lib/errors';

export const POST = api('brand:manage', async (req, { user }) => {
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new AppError('NO_FILE', 'لم يتم إرفاق ملف.', 422);
  if (file.size > 10 * 1024 * 1024) throw new AppError('TOO_LARGE', 'الملف أكبر من 10 ميغابايت.', 413);
  const b = await getBusiness();
  const asset = await uploadLogo(b.id, Buffer.from(await file.arrayBuffer()), user.email);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'brand.logo.upload', targetType: 'brand_asset', targetId: asset.id, details: { sha256: asset.sha256 } });
  return NextResponse.json(asset, { status: 201 });
});
