import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { api } from '@/lib/auth/server';
import { audit } from '@/lib/audit';
import { getBusiness } from '@/lib/business';
import { AccountInput } from '@/lib/validation';


export const GET = api('dashboard:view', async () => NextResponse.json(await prisma.socialAccount.findMany({ include: { connection: { select: { status: true, provider: true, canPublish: true, lastVerifiedAt: true, lastError: true } } }, orderBy: { createdAt: 'asc' } })));

export const POST = api('accounts:manage', async (req, { user }) => {
  const data = AccountInput.parse(await req.json());
  const b = await getBusiness();
  const acc = await prisma.socialAccount.create({ data: { ...data, businessId: b.id } });
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'account.create', targetType: 'social_account', targetId: acc.id });
  return NextResponse.json(acc, { status: 201 });
});
