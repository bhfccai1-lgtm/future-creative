import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { CampaignInput } from '@/lib/validation';
import { nextSlot } from '@/lib/campaigns/slots';
import { ruleOf } from '@/lib/campaigns/cycle';

export const GET = api('dashboard:view', async () => NextResponse.json(await prisma.campaign.findMany({ orderBy: { createdAt: 'desc' } })));

/** Create a campaign. Every slot produces a NEW AI design (never a repost); publishing follows the normal approval mode. */
export const POST = api('ads:create', async (req, { user }) => {
  const b = CampaignInput.parse(await req.json());
  if (b.endAt && b.endAt <= b.startAt) throw new AppError('BAD_DATES', 'تاريخ النهاية يجب أن يكون بعد البداية.', 422);
  const known = await prisma.socialAccount.count({ where: { id: { in: b.accountIds } } });
  if (known !== b.accountIds.length) throw new AppError('BAD_ACCOUNTS', 'حساب غير موجود في القائمة.', 422);
  const data = { ...b, direction: b.direction ?? undefined, createdBy: user.email, runs: 0 };
  const first = nextSlot(ruleOf({ ...data, endAt: b.endAt ?? null, maxRuns: b.maxRuns ?? null }), new Date());
  if (!first) throw new AppError('NO_SLOTS', 'لا توجد مواعيد مستقبلية بهذه الإعدادات — راجع التاريخ والأيام.', 422);
  const c = await prisma.campaign.create({ data: { ...data, nextRunAt: first } });
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'campaign.create', targetType: 'campaign', targetId: c.id, details: { name: c.name, accounts: c.accountIds.length, first: first.toISOString() } });
  return NextResponse.json(c, { status: 201 });
});
