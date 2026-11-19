import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { accountPlans } from '@/lib/growth/account-plan';

export const GET = api('dashboard:view', async (req) => {
  const u = new URL(req.url);
  const days = Math.min(90, Math.max(7, Number(u.searchParams.get('days')) || 30));
  return NextResponse.json({ plans: await accountPlans({ days, accountId: u.searchParams.get('accountId') ?? undefined }) });
});
