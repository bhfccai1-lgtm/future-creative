import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { loadInsights } from '@/lib/analytics/account-insights';
import { buildPostingPlan, type PlanCurrent } from '@/lib/analytics/posting-plan';

const Body = z.object({ accountIds: z.array(z.string().max(60)).max(100).optional() });

/** Applies the smart posting plan (rhythm + format mix) to the chosen accounts — settings only, never publishes. */
export const POST = api('accounts:manage', async (req, { user }) => {
  const { accountIds } = Body.parse(await req.json().catch(() => ({})));
  const snap = await loadInsights();
  if (!snap) throw new AppError('NO_DATA', 'اجلب بيانات الحسابات من Metricool أولًا (زر «تحديث الآن»).', 409);
  const accounts = await prisma.socialAccount.findMany({ select: { id: true, publishIntervalMinutes: true, maxDailyAds: true, formatStrategy: true, formatMix: true, publishWindowStart: true, publishWindowEnd: true, autoPublishEnabled: true } });
  const current: Record<string, PlanCurrent> = Object.fromEntries(accounts.map(({ id, ...c }) => [id, c]));
  const rows = buildPostingPlan(snap, current).filter((r) => r.changed && (!accountIds || accountIds.includes(r.accountId)));
  for (const r of rows) {
    await prisma.socialAccount.update({ where: { id: r.accountId }, data: { publishIntervalMinutes: r.intervalMinutes, maxDailyAds: r.maxDaily, formatStrategy: 'GROWTH_MIX', formatMix: r.mix } });
    await audit({ actorId: user.sub, actorLabel: user.email, action: 'account.posting_plan.apply', targetType: 'social_account', targetId: r.accountId,
      details: { tier: r.tier, before: { interval: r.current.publishIntervalMinutes, maxDaily: r.current.maxDailyAds, strategy: r.current.formatStrategy, mix: (r.current.formatMix ?? null) as never }, after: { interval: r.intervalMinutes, maxDaily: r.maxDaily, mix: r.mix }, reasons: r.reasons } });
  }
  return NextResponse.json({ ok: true, applied: rows.length, message: rows.length ? `طُبّقت الخطة على ${rows.length} حساب ✓` : 'كل الحسابات مطابقة للخطة بالفعل' });
});
