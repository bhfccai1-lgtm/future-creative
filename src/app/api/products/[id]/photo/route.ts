import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { api } from '@/lib/auth/server';
import { audit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { saveReference } from '@/lib/creative/references';

/** Real product photo (reference for the AI): upload / replace. */
export const POST = api<{ params: Promise<{ id: string }> }>('products:manage', async (req, { params, user }) => {
  const { id } = await params;
  await prisma.product.findUniqueOrThrow({ where: { id }, select: { id: true } });
  const file = (await req.formData()).get('file');
  if (!(file instanceof File)) throw new AppError('NO_FILE', 'لم يتم إرفاق صورة.', 422);
  const key = await saveReference('product', id, Buffer.from(await file.arrayBuffer()));
  await prisma.product.update({ where: { id }, data: { photoKey: key } });
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'product.photo.upload', targetType: 'product', targetId: id, details: { key } });
  return NextResponse.json({ photoKey: key }, { status: 201 });
});

export const DELETE = api<{ params: Promise<{ id: string }> }>('products:manage', async (_req, { params, user }) => {
  const { id } = await params;
  await prisma.product.update({ where: { id }, data: { photoKey: null } });
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'product.photo.remove', targetType: 'product', targetId: id });
  return NextResponse.json({ ok: true });
});
