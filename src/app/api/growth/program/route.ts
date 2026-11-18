import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { can } from '@/lib/auth/rbac';
import { loadInsights } from '@/lib/analytics/account-insights';
import { buildPostingPlan, type PlanCurrent } from '@/lib/analytics/posting-plan';
import { baselineOf, diagnose, loadProgram, PROGRAM_DAYS, saveProgram, targetsFor, type GrowthProgram } from '@/lib/growth/program';

const Body = z.object({ accountIds: z.array(z.string().max(60)).min(1).max(100), enableDaily: z.boolean().default(false) });

/** Start the 30-day growth program: diagnosis + targets frozen as the baseline, posting plan applied. */
export const POST = api('accounts:manage', async (req, { user }) => {
  const { accountIds, enableDaily } = Body.parse(await req.json());
  if (enableDaily && !can(user.perms, 'automation:control')) throw new AppError('FORBIDDEN', 'تشغيل التوليد اليومي يحتاج صلاحية التحكم بالأتمتة.', 403);
  const existing = await loadProgram();
  if (existing && new Date(existing.endsAt).getTime() > Date.now()) throw new AppError('ALREADY_RUNNING', 'يوجد برنامج نمو قيد التنفيذ — أوقفه أولًا لبدء برنامج جديد.', 409);
  const snap = await loadInsights();
  if (!snap) throw new AppError('NO_DATA', 'اجلب بيانات الحسابات من Metricool أولًا (التحليلات ← تحديث الآن).', 409);
  const rows = await prisma.socialAccount.findMany({ include: { connection: true } });
  const current: Record<string, PlanCurrent> = Object.fromEntries(rows.map((a) => [a.id, { publishIntervalMinutes: a.publishIntervalMinutes, maxDailyAds: a.maxDailyAds, formatStrategy: a.formatStrategy, formatMix: a.formatMix, publishWindowStart: a.publishWindowStart, publishWindowEnd: a.publishWindowEnd, autoPublishEnabled: a.autoPublishEnabled }]));
  const plan = buildPostingPlan(snap, current).filter((r) => accountIds.includes(r.accountId));
  if (!plan.length) throw new AppError('NO_ACCOUNTS', 'لا توجد بيانات صالحة للحسابات المختارة — حدّث التحليلات.', 409);
  const now = new Date();
  const program: GrowthProgram = {
    startedAt: now.toISOString(), endsAt: new Date(now.getTime() + PROGRAM_DAYS * 86400_000).toISOString(), by: user.email, reports: [],
    accounts: plan.map((r) => {
      const ins = snap.accounts.find((a) => a.accountId === r.accountId)!;
      const b = baselineOf(ins);
      return { accountId: r.accountId, name: r.name, tier: r.tier, baseline: b, targets: targetsFor(r.tier, b, r.postsPerDay * PROGRAM_DAYS), findings: diagnose(ins, snap) };
    }),
  };
  const enabled: string[] = [];
  for (const r of plan) {
    await prisma.socialAccount.update({ where: { id: r.accountId }, data: { publishIntervalMinutes: r.intervalMinutes, maxDailyAds: r.maxDaily, formatStrategy: 'GROWTH_MIX', formatMix: r.mix } });
    const acc = rows.find((a) => a.id === r.accountId);
    if (enableDaily && acc && !acc.autoPublishEnabled && acc.connection?.status === 'CONNECTED' && acc.connection.canPublish && !acc.paused) {
      await prisma.socialAccount.update({ where: { id: r.accountId }, data: { autoPublishEnabled: true } });
      enabled.push(r.name);
    }
  }
  await saveProgram(program);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'growth.program.start', details: { accounts: plan.map((r) => r.name), enabledDaily: enabled, endsAt: program.endsAt } });
  return NextResponse.json({ ok: true, message: `بدأ برنامج النمو لـ ${plan.length} حساب لمدة ${PROGRAM_DAYS} يومًا ✓${enabled.length ? ` — فُعّل التوليد اليومي لـ ${enabled.length}` : ''}` });
});

export const DELETE = api('accounts:manage', async (_req, { user }) => {
  const p = await loadProgram();
  if (!p) return NextResponse.json({ ok: true, message: 'لا يوجد برنامج' });
  await saveProgram(null);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'growth.program.stop', details: { startedAt: p.startedAt, accounts: p.accounts.length } });
  return NextResponse.json({ ok: true, message: 'أُوقف البرنامج — إعدادات النشر الحالية تبقى كما هي' });
});
