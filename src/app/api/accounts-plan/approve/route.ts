import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { approvePlanIdeas, planIdeasByKey } from '@/lib/growth/account-plan';

/** «اعتمد في بنك الأفكار»: the automatic schedule designs approved ideas one by one (normal approval rules apply) */
export const POST = api('ads:create', async (req, { user }) => {
  const b = z.object({ accountId: z.string().max(40), keys: z.array(z.string().max(60)).min(1).max(10) }).parse(await req.json());
  const r = await approvePlanIdeas(b.accountId, await planIdeasByKey(b.accountId, b.keys), user);
  return NextResponse.json({ ok: true, ...r });
});
