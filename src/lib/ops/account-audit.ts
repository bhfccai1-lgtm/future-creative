import { prisma } from '../db';
import { planRecommended } from './recommended';
import { linkedNetworks } from '../publishing/channels';

/**
 * Per-account Instagram audit (last 14 days): what was really published (provider-verified), format mix,
 * reach per format from imported Metricool metrics, failures, and configuration problems — each issue with
 * a concrete fix (one click where safe). Real data only; missing metrics are reported as missing, never guessed.
 */
export type Severity = 'critical' | 'high' | 'medium' | 'low';
export interface Fix { label: string; href?: string; action?: { url: string; method: 'POST' | 'PATCH'; body?: Record<string, unknown> } }
export interface Issue { id: string; severity: Severity; title: string; evidence: string; fix: Fix[] }
export interface AccountAudit {
  id: string; name: string; handle: string | null; score: number; grade: 'A' | 'B' | 'C' | 'D';
  kpi: { posted: number; expected: number | null; reels: number; carousels: number; feed: number; stories: number; failed: number; daysSinceLast: number | null; avgReachReel: number | null; avgReachOther: number | null; measured: number };
  issues: Issue[]; strengths: string[];
}

const W: Record<Severity, number> = { critical: 35, high: 20, medium: 10, low: 5 };
const DAYS = 14;
const avg = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);

export async function auditAccounts(now = new Date()): Promise<AccountAudit[]> {
  const since = new Date(now.getTime() - DAYS * 86400_000);
  const [accounts, results, failed, plan] = await Promise.all([
    prisma.socialAccount.findMany({ include: { connection: true }, orderBy: { name: 'asc' } }),
    prisma.publicationResult.findMany({
      where: { verifiedAt: { gte: since }, job: { primary: true } },
      select: { verifiedAt: true, metrics: true, metricsFetchedAt: true, job: { select: { accountId: true, advertisement: { select: { format: true, createdBy: true } } } } },
    }),
    prisma.publicationJob.groupBy({ by: ['accountId'], where: { state: 'FAILED', primary: true, updatedAt: { gte: since } }, _count: true }),
    planRecommended(),
  ]);
  const lastEver = new Map((await prisma.publicationJob.groupBy({ by: ['accountId'], where: { primary: true, result: { verifiedAt: { not: null } } }, _max: { scheduledFor: true } })).map((r) => [r.accountId, r._max.scheduledFor!]));

  return accounts.map((a) => {
    const mine = results.filter((r) => r.job.accountId === a.id);
    const fmt = (f: string) => mine.filter((r) => r.job.advertisement.format === f).length;
    const reachOf = (r: (typeof mine)[number]) => { const m = (r.metrics ?? {}) as { reach?: number | null; views?: number | null }; return m.reach ?? m.views ?? null; };
    const measured = mine.filter((r) => r.metricsFetchedAt && reachOf(r) != null);
    const reelReach = measured.filter((r) => r.job.advertisement.format === 'REEL_VIDEO').map((r) => reachOf(r)!);
    const otherReach = measured.filter((r) => !['REEL_VIDEO', 'IMAGE_STORY'].includes(r.job.advertisement.format)).map((r) => reachOf(r)!);
    const last = lastEver.get(a.id) ?? null;
    const daysSinceLast = last ? Math.floor((now.getTime() - last.getTime()) / 86400_000) : null;
    const expected = a.autoPublishEnabled ? Math.min(Math.floor((DAYS * 1440) / a.publishIntervalMinutes), a.maxDailyAds * DAYS) : null;
    const kpi = { posted: mine.length, expected, reels: fmt('REEL_VIDEO'), carousels: fmt('IMAGE_CAROUSEL'), feed: fmt('IMAGE_FEED') + fmt('IMAGE_SQUARE'), stories: fmt('IMAGE_STORY'), failed: failed.find((f) => f.accountId === a.id)?._count ?? 0, daysSinceLast, avgReachReel: avg(reelReach), avgReachOther: avg(otherReach), measured: measured.length };

    const issues: Issue[] = [];
    const strengths: string[] = [];
    const conn = a.connection;
    const editLink = { label: 'إعدادات الحساب', href: `/accounts/${a.id}` };
    if (!conn || conn.status !== 'CONNECTED' || !conn.canPublish) issues.push({ id: 'not_connected', severity: 'critical', title: 'الحساب غير مرتبط بصلاحية نشر', evidence: conn ? `حالة الربط: ${conn.status}${conn.lastError ? ` — ${conn.lastError}` : ''}` : 'لا يوجد ربط مع Metricool', fix: [{ label: 'فحص كل الحسابات', action: { url: '/api/accounts/verify-all', method: 'POST' } }, { label: 'إعدادات الربط', href: '/settings/integrations' }] });
    if (a.paused) issues.push({ id: 'paused', severity: 'high', title: 'الحساب موقوف طارئًا', evidence: 'لا توليد ولا نشر حتى تستأنفه', fix: [editLink] });
    if (!a.autoPublishEnabled) issues.push({ id: 'auto_off', severity: mine.length ? 'medium' : 'high', title: 'النشر الآلي متوقف لهذا الحساب', evidence: `نُشر ${mine.length} منشور مؤكد خلال ${DAYS} يومًا — الحسابات التي تنشر بانتظام تحصل على توزيع أكبر`, fix: [{ label: 'التحكم في الأتمتة', href: '/schedule' }] });
    if (!mine.length) issues.push({ id: 'no_posts', severity: 'critical', title: `لا منشورات مؤكدة خلال ${DAYS} يومًا`, evidence: daysSinceLast === null ? 'لم يُنشر عبر النظام أبدًا' : `آخر منشور قبل ${daysSinceLast} يومًا`, fix: [{ label: 'إنشاء تصميم الآن', href: '/create' }, { label: 'حملة لهذا الحساب', href: '/campaigns' }] });
    else if (expected && mine.length < expected * 0.5) issues.push({ id: 'under_posting', severity: 'medium', title: 'النشر أقل من نصف المخطط', evidence: `${mine.length} من ${expected} متوقع (كل ${Math.round(a.publishIntervalMinutes / 60)} ساعات)`, fix: [{ label: 'سجل المنشورات', href: '/posts' }, { label: 'الأخطاء والتنبيهات', href: '/diagnostics' }] });
    if (kpi.failed >= 2) issues.push({ id: 'failures', severity: 'high', title: 'فشل متكرر في النشر', evidence: `${kpi.failed} مهمة فاشلة خلال ${DAYS} يومًا`, fix: [{ label: 'المنشورات الفاشلة', href: '/posts?state=FAILED' }] });
    const nonStory = mine.length - kpi.stories;
    if (a.formatStrategy !== 'GROWTH_MIX') issues.push({ id: 'fixed_format', severity: a.publishFormat === 'IMAGE_STORY' ? 'high' : 'medium', title: 'صيغة ثابتة بدل مزيج النمو', evidence: a.publishFormat === 'IMAGE_STORY' ? 'الحساب ينشر ستوري فقط — الستوري لا تصل لغير المتابعين ولا تجلب متابعين جددًا' : 'صيغة واحدة تقلل الوصول؛ الريلز هي أكبر مصدر وصول لغير المتابعين', fix: [{ label: 'تفعيل مزيج النمو', action: { url: `/api/accounts/${a.id}`, method: 'PATCH', body: { formatStrategy: 'GROWTH_MIX' } } }] });
    else if (mine.length >= 4 && kpi.reels / mine.length < 0.3) issues.push({ id: 'few_reels', severity: 'medium', title: 'الريلز أقل من 30% من المنشورات', evidence: `${kpi.reels} ريلز من ${mine.length}`, fix: [{ label: 'حملة ريلز', href: '/campaigns' }] });
    if (kpi.avgReachReel != null && kpi.avgReachOther != null && reelReach.length >= 2 && otherReach.length >= 2) {
      if (kpi.avgReachReel >= kpi.avgReachOther * 1.5) strengths.push(`الريلز تصل ${Math.round((kpi.avgReachReel / Math.max(1, kpi.avgReachOther)) * 10) / 10}× أكثر من الصور (${kpi.avgReachReel} مقابل ${kpi.avgReachOther})`);
      else if (kpi.avgReachOther > kpi.avgReachReel * 1.5) strengths.push(`الصور/الكاروسيل تتفوق هنا على الريلز (${kpi.avgReachOther} مقابل ${kpi.avgReachReel}) — حافظ على نسبتها`);
    }
    if (nonStory >= 3 && measured.length < nonStory * 0.5) issues.push({ id: 'no_metrics', severity: 'low', title: 'منشورات بلا مقاييس أداء', evidence: `${measured.length} مقاس من ${nonStory}`, fix: [{ label: 'استيراد المقاييس من التقارير', href: '/reports' }] });
    const p = plan.find((r) => r.id === a.id);
    if (p?.niche && p.categories.length) issues.push({ id: 'off_niche', severity: 'medium', title: `حساب متخصص (${p.niche}) بلا فئات — ينشر كل المنتجات`, evidence: `الفئات المقترحة: ${p.categories.join('، ')}`, fix: [{ label: 'الإعداد الموصى به', href: '/schedule' }, editLink] });
    const unused = linkedNetworks(conn?.providerSnapshot).filter((n) => n !== 'gmb' && n !== a.platform && !a.autoChannels.includes(n as never));
    if (unused.length) issues.push({ id: 'unused_channels', severity: 'low', title: 'قنوات مرتبطة لا يُنشر عليها', evidence: unused.join('، '), fix: [{ label: 'انشر على كل القنوات المرتبطة', action: { url: '/api/accounts/auto-channels', method: 'POST' } }] });
    if (linkedNetworks(conn?.providerSnapshot).includes('gmb') && !a.gbpAuto) issues.push({ id: 'gbp_off', severity: 'low', title: 'ملف Google التجاري مرتبط لكن النشر عليه متوقف', evidence: 'تحديثات Google تظهر في الخرائط والبحث المحلي', fix: [{ label: 'تفعيل Google تلقائيًا', action: { url: `/api/accounts/${a.id}`, method: 'PATCH', body: { gbpAuto: true } } }] });
    const [sh, sm] = a.publishWindowStart.split(':').map(Number), [eh, em] = a.publishWindowEnd.split(':').map(Number);
    if ((eh * 60 + em) - (sh * 60 + sm) < 8 * 60) issues.push({ id: 'narrow_window', severity: 'low', title: 'نافذة النشر ضيقة', evidence: `${a.publishWindowStart}–${a.publishWindowEnd} تفوّت ساعات الذروة (10–12 و18)`, fix: [editLink] });
    if (!a.handle) issues.push({ id: 'no_handle', severity: 'low', title: 'المعرّف (@handle) غير مسجل', evidence: 'يُستخدم في الترويج المتبادل والتقارير', fix: [editLink] });
    if (mine.length >= Math.max(4, (expected ?? 0) * 0.8)) strengths.push(`نشر منتظم: ${mine.length} منشور مؤكد خلال ${DAYS} يومًا`);
    if (kpi.reels >= 3) strengths.push(`${kpi.reels} ريلز — أفضل صيغة للوصول`);

    const order: Severity[] = ['critical', 'high', 'medium', 'low'];
    issues.sort((x, y) => order.indexOf(x.severity) - order.indexOf(y.severity));
    const score = Math.max(0, 100 - issues.reduce((n, i) => n + W[i.severity], 0));
    const grade: AccountAudit['grade'] = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : 'D';
    return { id: a.id, name: a.name, handle: a.handle, score, grade, kpi, issues, strengths };
  }).sort((x, y) => x.score - y.score);
}
