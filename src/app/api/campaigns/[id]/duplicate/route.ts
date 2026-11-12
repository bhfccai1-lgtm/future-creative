import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { api } from '@/lib/auth/server';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';
import { nextSlot } from '@/lib/campaigns/slots';
import { ruleOf } from '@/lib/campaigns/cycle';

type P = { params: Promise<{ id: string }> };
/** Copy a campaign (paused, starting now) so it can be adjusted for another occasion or account set. */
export const POST = api<P>('ads:create', async (_req, { params, user }) => {
  const { id } = await params;
  const c = await prisma.campaign.findUniqueOrThrow({ where: { id } });
  const startAt = new Date(Math.max(Date.now(), c.startAt.getTime()));
  const base = { name: `${c.name} (نسخة)`, accountIds: c.accountIds, productId: c.productId, format: c.format, language: c.language, direction: (c.direction ?? undefined) as Prisma.InputJsonValue | undefined, scheduleType: c.scheduleType, everyHours: c.everyHours, daysOfWeek: c.daysOfWeek, timeMode: c.timeMode, startAt, endAt: c.endAt && c.endAt > startAt ? c.endAt : null, maxRuns: c.maxRuns };
  const copy = await prisma.campaign.create({ data: { ...base, active: false, runs: 0, createdBy: user.email, nextRunAt: nextSlot(ruleOf({ ...base, runs: 0 }), new Date()) } });
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'campaign.duplicate', targetType: 'campaign', targetId: copy.id, details: { from: id } });
  return NextResponse.json(copy, { status: 201 });
});
