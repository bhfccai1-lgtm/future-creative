import { prisma } from '../db';
import { analyse, loadSamples } from './insights';
import { startOfDayInTz, fmtLocal } from '../time';

export type Period = 'week' | 'month';
export interface Report {
  period: Period; from: string; to: string; accountId: string | null; accountName: string | null;
  publishing: Record<string, number>;
  metrics: { posts: number; withMetrics: number; reach: number; views: number; likes: number; comments: number; saves: number; shares: number; avgEngagement: number | null; reelSkipRatePct: number | null; reelRetentionPct: number | null };
  top: { headline: string | null; account: string; score: number; url: string | null; at: string }[];
  bottom: { headline: string | null; account: string; score: number; url: string | null; at: string }[];
  failures: { account: string; at: string; error: string }[];
  analysis: ReturnType<typeof analyse>;
  recommendations: string[];
  generatedAt: string;
}

/** Verified-only performance report. Every number comes from the database; nothing is estimated. */
export async function buildReport(period: Period, accountId?: string, now = new Date()): Promise<Report> {
  const to = now;
  const from = new Date(startOfDayInTz(now).getTime() - (period === 'week' ? 7 : 30) * 86400_000);
  const acc = accountId ? await prisma.socialAccount.findUnique({ where: { id: accountId }, select: { name: true } }) : null;
  const jobWhere = { scheduledFor: { gte: from, lt: to }, ...(accountId ? { accountId } : {}) };
  const [byState, verified, failures] = await Promise.all([
    prisma.publicationJob.groupBy({ by: ['state'], _count: true, where: jobWhere }),
    prisma.publicationResult.findMany({ where: { verifiedAt: { not: null }, job: jobWhere }, include: { job: { include: { account: { select: { name: true } }, advertisement: { select: { headline: true } } } } } }),
    prisma.publicationJob.findMany({ where: { ...jobWhere, state: { in: ['FAILED', 'UNKNOWN'] } }, include: { account: { select: { name: true } } }, orderBy: { scheduledFor: 'desc' }, take: 20 }),
  ]);
  const sum = (k: string) => verified.reduce((a, r) => a + (Number((r.metrics as Record<string, unknown> | null)?.[k]) || 0), 0);
  const scored = verified.filter((r) => r.engagementScore !== null).sort((a, b) => b.engagementScore! - a.engagementScore!);
  const row = (r: (typeof scored)[number]) => ({ headline: r.job.advertisement.headline, account: r.job.account.name, score: Number(r.engagementScore!.toFixed(2)), url: r.publicUrl, at: fmtLocal(r.job.scheduledFor) });
  const analysis = analyse(await loadSamples({ accountId, since: new Date(now.getTime() - 90 * 86400_000) }));

  const recs: string[] = [];
  const pub = Object.fromEntries(byState.map((s) => [s.state, s._count]));
  const avgOf = (k: string) => { const xs = verified.map((r) => Number((r.metrics as Record<string, unknown> | null)?.[k])).filter((x) => Number.isFinite(x)); return xs.length ? Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1)) : null; };
  const skip = avgOf('skipRatePct'), retention = avgOf('retentionPct');
  if (!verified.length) recs.push('لا توجد منشورات مؤكدة النشر في هذه الفترة — لا يمكن استخلاص توصيات أداء.');
  else if (!scored.length) recs.push('المنشورات مؤكدة لكن بلا مقاييس تفاعل بعد — شغّل استيراد التحليلات من Metricool أو أدخل المقاييس يدويًا.');
  if ((pub.UNKNOWN ?? 0) > 0) recs.push(`${pub.UNKNOWN} منشور بنتيجة غير مؤكدة — راجعها من «سجل المنشورات» (بحث ثم إعادة إرسال أو إلغاء).`);
  if ((pub.FAILED ?? 0) > 0) recs.push(`${pub.FAILED} منشور فاشل — راجع أسباب الفشل أدناه قبل زيادة وتيرة النشر.`);
  if (skip !== null && skip > 60) recs.push(`متوسط تخطي الريلز ${skip}% — أغلب المشاهدين يغادرون في أول 3 ثوانٍ: افتح بالمنتج والوعد مباشرة (وضع الافتتاحية القوية مفعّل افتراضيًا) واختصر الريلز إلى 7–10 ثوانٍ.`);
  if (scored.length >= 3 && sum('comments') === 0 && sum('shares') === 0) recs.push('صفر تعليقات ومشاركات — استخدم دعوة «أرسله لصديق» وكلمة مفتاحية للرسائل الخاصة بدل الأسئلة العامة.');
  if (analysis.smallSample) recs.push(`العينة صغيرة (${analysis.total} منشور بمقاييس خلال 90 يومًا) — اعتبر الأنماط اتجاهات وليست نتائج مؤكدة.`);
  for (const i of analysis.insights.slice(0, 4)) {
    recs.push(i.confidence === 'CONFIRMED' ? `ثبّت: ${i.note}` : i.experiment ? `جرّب A/B في «${i.dimensionAr}»: ${i.note}${i.experiment.perVariant ? ` يلزم تقريبًا ${i.experiment.perVariant} منشورًا لكل نسخة.` : ''}` : i.note);
  }
  return {
    period, from: from.toISOString(), to: to.toISOString(), accountId: accountId ?? null, accountName: acc?.name ?? null,
    publishing: pub,
    metrics: { posts: verified.length, withMetrics: scored.length, reach: sum('reach'), views: sum('views'), likes: sum('likes'), comments: sum('comments'), saves: sum('saves'), shares: sum('shares'), avgEngagement: scored.length ? Number((scored.reduce((a, r) => a + r.engagementScore!, 0) / scored.length).toFixed(2)) : null, reelSkipRatePct: skip, reelRetentionPct: retention },
    top: scored.slice(0, 3).map(row), bottom: scored.length > 3 ? scored.slice(-3).reverse().map(row) : [],
    failures: failures.map((f) => ({ account: f.account.name, at: fmtLocal(f.scheduledFor), error: f.lastError ?? f.state })),
    analysis, recommendations: recs, generatedAt: now.toISOString(),
  };
}
