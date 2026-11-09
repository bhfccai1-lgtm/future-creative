import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { api } from '@/lib/auth/server';
import { audit } from '@/lib/audit';
import { AppError } from '@/lib/errors';

const Body = z.object({ authorized: z.boolean() });
/** Per-account autonomous-publishing authorisation (admin only). */
export const POST = api<{ params: Promise<{ id: string }> }>('autonomy:authorize', async (req, { params, user }) => {
  const { id } = await params;
  const { authorized } = Body.parse(await req.json());
  if (authorized) {
    const c = await prisma.socialConnection.findUnique({ where: { accountId: id } });
    if (!c || c.status !== 'CONNECTED' || !c.canPublish) throw new AppError('NOT_CONNECTED', 'لا يمكن تفويض حساب غير مرتبط.', 412);
  }
  const acc = await prisma.socialAccount.update({ where: { id }, data: { autonomousAuthorized: authorized, autonomousAuthorizedAt: authorized ? new Date() : null, autonomousAuthorizedBy: authorized ? user.email : null } });
  await audit({ actorId: user.sub, actorLabel: user.email, action: authorized ? 'account.autonomy_authorize' : 'account.autonomy_revoke', targetType: 'social_account', targetId: id });
  return NextResponse.json(acc);
});
