import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';
import { nextSlot } from '@/lib/campaigns/slots';
import { ruleOf } from '@/lib/campaigns/cycle';
import { AppError } from '@/lib/errors';
import { CampaignInput } from '@/lib/validation';

type P = { params: Promise<{ id: string }> };
const Body = z.object({ active: z.boolean() });

/** Pause / resume. Resuming recomputes the next slot from now (missed slots are not back-filled). */
export const PATCH = api<P>('ads:create', async (req, { params, user }) => {
  const { id } = await params;
  const { active } = Body.parse(await req.json());
  const c = await prisma.campaign.findUniqueOrThrow({ where: { id } });
  const nextRunAt = active ? nextSlot(ruleOf(c), new Date()) : c.nextRunAt;
  const u = await prisma.campaign.update({ where: { id }, data: { active: active && nextRunAt !== null, nextRunAt } });
  await audit({ actorId: user.sub, actorLabel: user.email, action: active ? 'campaign.resume' : 'campaign.pause', targetType: 'campaign', targetId: id });
  return NextResponse.json(u);
});

/** Delete the campaign. Designs already generated stay in the library / approval queue. */
export const DELETE = api<P>('ads:create', async (_req, { params, user }) => {
  const { id } = await params;
  await prisma.campaign.delete({ where: { id } });
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'campaign.delete', targetType: 'campaign', targetId: id });
  return NextResponse.json({ ok: true });
});

/** Edit everything. Runs/history are kept; the next slot is recomputed from now with the new rule. */
export const PUT = api<P>('ads:create', async (req, { params, user }) => {
  const { id } = await params;
  const b = CampaignInput.parse(await req.json());
  if (b.endAt && b.endAt <= b.startAt) throw new AppError('BAD_DATES', 'تاريخ النهاية يجب أن يكون بعد البداية.', 422);
  const known = await prisma.socialAccount.count({ where: { id: { in: b.accountIds } } });
  if (known !== b.accountIds.length) throw new AppError('BAD_ACCOUNTS', 'حساب غير موجود في القائمة.', 422);
  const c = await prisma.campaign.findUniqueOrThrow({ where: { id } });
  const data = { ...b, direction: b.direction ?? undefined, endAt: b.endAt ?? null, maxRuns: b.maxRuns ?? null };
  const nextRunAt = nextSlot(ruleOf({ ...data, runs: c.runs }), new Date());
  const u = await prisma.campaign.update({ where: { id }, data: { ...data, nextRunAt, active: c.active && nextRunAt !== null } });
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'campaign.update', targetType: 'campaign', targetId: id, details: { name: u.name, accounts: u.accountIds.length, next: nextRunAt?.toISOString() ?? null } });
  return NextResponse.json(u);
});
