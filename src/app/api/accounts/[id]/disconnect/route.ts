import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { api } from '@/lib/auth/server';
import { audit } from '@/lib/audit';

/** Disconnect ONE account: disables its automation and cancels its not-yet-submitted jobs. Other accounts are untouched. */
export const POST = api<{ params: Promise<{ id: string }> }>('accounts:manage', async (_req, { params, user }) => {
  const { id } = await params;
  await prisma.$transaction([
    prisma.socialConnection.updateMany({ where: { accountId: id }, data: { status: 'DISCONNECTED', canPublish: false, encryptedToken: null } }),
    prisma.socialAccount.update({ where: { id }, data: { autoPublishEnabled: false, autonomousAuthorized: false } }),
    prisma.publicationJob.updateMany({ where: { accountId: id, state: 'QUEUED' }, data: { state: 'REJECTED', lastError: 'account disconnected' } }),
    prisma.advertisement.updateMany({ where: { accountId: id, state: 'QUEUED' }, data: { state: 'REJECTED', errorMessage: 'account disconnected' } }),
  ]);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'account.disconnect', targetType: 'social_account', targetId: id });
  return NextResponse.json({ ok: true });
});
