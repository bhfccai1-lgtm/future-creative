import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { audit, notify } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { integrationApi } from '@/lib/integrations/auth';

const Body = z.object({ paused: z.boolean(), by: z.string().max(80), reason: z.string().max(200).optional() });
/** POST — emergency pause/resume of one account from n8n (e.g. a Telegram command). Off unless the admin allows it. */
export const POST = integrationApi<{ params: Promise<{ id: string }> }>(async (req, { params, settings }) => {
  if (!settings.n8n.allowInboundControl) throw new AppError('FORBIDDEN', 'التحكم بالحسابات من n8n غير مسموح في الإعدادات.', 403);
  const { id } = await params;
  const b = Body.parse(await req.json());
  const acc = await prisma.socialAccount.update({ where: { id }, data: { paused: b.paused, pausedReason: b.paused ? (b.reason ?? `n8n:${b.by}`) : null, pausedAt: b.paused ? new Date() : null } });
  await audit({ actorLabel: `n8n:${b.by}`, action: b.paused ? 'account.pause' : 'account.resume', targetType: 'social_account', targetId: id, details: { reason: b.reason ?? null } });
  await notify(b.paused ? 'WARNING' : 'INFO', b.paused ? 'ACCOUNT_PAUSED' : 'ACCOUNT_RESUMED', b.paused ? 'تم إيقاف حساب مؤقتًا (n8n)' : 'تم استئناف حساب (n8n)', `${acc.name} — ${b.by}`, id);
  return NextResponse.json({ id, paused: acc.paused });
});
