import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { api } from '@/lib/auth/server';
import { audit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { AccountInput } from '@/lib/validation';

type P = { params: Promise<{ id: string }> };

export const PATCH = api<P>('accounts:manage', async (req, { params, user }) => {
  const { id } = await params;
  const body = await req.json();
  const data = AccountInput.partial().parse(body);
  const toggle = typeof body.autoPublishEnabled === 'boolean' ? { autoPublishEnabled: body.autoPublishEnabled as boolean } : {};
  if (toggle.autoPublishEnabled) {
    const c = await prisma.socialConnection.findUnique({ where: { accountId: id } });
    if (!c || c.status !== 'CONNECTED' || !c.canPublish) throw new AppError('NOT_CONNECTED', 'لا يمكن تفعيل النشر الآلي لحساب غير مرتبط ومؤكد.', 412);
  }
  const acc = await prisma.socialAccount.update({ where: { id }, data: { ...data, ...toggle } });
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'account.update', targetType: 'social_account', targetId: id, details: { fields: Object.keys({ ...data, ...toggle }) } });
  return NextResponse.json(acc);
});
