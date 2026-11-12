import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { api } from '@/lib/auth/server';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';
import { upgradePlan } from '@/lib/campaigns/upgrade';

/**
 * Bring campaigns created before the new defaults up to date (preview with dryRun):
 *  silent audio → the settings' reel audio (music/voice), no design method → «تلقائي», per-account format → smart format mix.
 * Explicit choices (a specific style, voice, format, product…) are kept.
 */
export const POST = api('ads:create', async (req, { user }) => {
  const { dryRun } = z.object({ dryRun: z.boolean().default(true) }).parse(await req.json().catch(() => ({})));
  const all = await prisma.campaign.findMany({ orderBy: { createdAt: 'asc' } });
  const plan = all.map(upgradePlan);
  const todo = plan.filter((p) => p.changes.length);
  if (!dryRun) {
    for (const p of todo) await prisma.campaign.update({ where: { id: p.id }, data: { direction: p.direction as Prisma.InputJsonValue } });
    await audit({ actorId: user.sub, actorLabel: user.email, action: 'campaign.upgrade', details: { campaigns: todo.map((p) => ({ name: p.name, changes: p.changes })) } });
  }
  return NextResponse.json({ dryRun, total: all.length, changed: todo.length, plan: todo.map(({ id, name, changes }) => ({ id, name, changes })) });
});
