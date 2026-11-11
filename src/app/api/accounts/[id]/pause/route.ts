import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { api } from '@/lib/auth/server';
import { audit, notify } from '@/lib/audit';

const Body = z.object({ paused: z.boolean(), reason: z.string().max(200).optional() });
/** Per-account emergency pause: stops automatic generation AND holds every queued submission for this account. */
export const POST = api<{ params: Promise<{ id: string }> }>('killswitch:toggle', async (req, { params, user }) => {
  const { id } = await params;
  const { paused, reason } = Body.parse(await req.json());
  const acc = await prisma.socialAccount.update({ where: { id }, data: { paused, pausedReason: paused ? reason ?? null : null, pausedAt: paused ? new Date() : null } });
  await audit({ actorId: user.sub, actorLabel: user.email, action: paused ? 'account.pause' : 'account.resume', targetType: 'social_account', targetId: id, details: { reason: reason ?? null } });
  await notify(paused ? 'WARNING' : 'INFO', paused ? 'ACCOUNT_PAUSED' : 'ACCOUNT_RESUMED', paused ? 'تم إيقاف حساب مؤقتًا' : 'تم استئناف حساب', `${acc.name}${reason ? ` — ${reason}` : ''}`, id);
  return NextResponse.json({ id: acc.id, paused: acc.paused });
});
