import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/server';
import { PageHeader, Empty } from '@/components/ui';
import { ActionButton } from '@/components/action-button';
import { fmtLocal } from '@/lib/time';
import { qcVerdict, QC_VERDICT_AR, type QcReport } from '@/lib/qc';
import { algoInputFromAd, algorithmScore } from '@/lib/growth/algorithm';
import { sortQueue, triage, waitLabel } from '@/lib/approvals/triage';
import { ApprovalQueue, type QueueItem } from '@/components/approval-queue';

const REASON = { MANUAL_MODE: 'الوضع اليدوي', ASSISTED_MODE: 'الوضع المساعد', QC_FAILED: 'فشل فحص الجودة' } as Record<string, string>;
const FORMAT_AR: Record<string, string> = { REEL_VIDEO: 'ريلز', IMAGE_CAROUSEL: 'كاروسيل', IMAGE_FEED: 'منشور', IMAGE_SQUARE: 'مربع', IMAGE_STORY: 'ستوري' };

const LIST_MAX = 120; // a long queue would load every design with its media at once

export default async function ApprovalsPage() {
  const user = await requirePageUser();
  const canPublish = user.perms.includes('publish:now');
  const canPublishNow = canPublish;
  const items = await prisma.approvalRequest.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: LIST_MAX, include: { advertisement: { include: { media: true, account: true, product: true, brief: { select: { hashtags: true } }, jobs: { select: { scheduledFor: true, primary: true } } } } } });
  // «فشل» but every final file exists (e.g. a late step was stopped) — can still be published by a person
  const stuck = (await prisma.advertisement.findMany({ where: { state: 'FAILED', dryRun: false, createdAt: { gte: new Date(Date.now() - 14 * 86400_000) }, media: { some: { role: 'FINAL' } } }, orderBy: { createdAt: 'desc' }, take: 12, include: { media: true, account: true } }))
    .filter((a) => a.format !== 'REEL_VIDEO' || a.media.some((m) => m.role === 'VIDEO'));
  // counted in the database (not from the capped list) so «publish all» shows the real number
  const [ready, pendingTotal] = await Promise.all([
    prisma.approvalRequest.count({ where: { status: 'PENDING', advertisement: { qcPassed: true, dryRun: false, state: 'QUALITY_REVIEW' } } }),
    prisma.approvalRequest.count({ where: { status: 'PENDING' } }),
  ]);
  const now = new Date();
  const queue: QueueItem[] = sortQueue(items.map((r) => {
    const ad = r.advertisement;
    const qc = ad.qcReport as unknown as QcReport | null;
    const verdict = qcVerdict(qc);
    const rubric = ((ad.options ?? {}) as { adScore?: { total?: number } }).adScore?.total;
    const algo = algorithmScore(algoInputFromAd(ad)).score;
    const t = triage({ publishable: !!qc?.publishable, verdict, dryRun: ad.dryRun, rubric: typeof rubric === 'number' ? rubric : null, algorithm: algo, createdAt: r.createdAt }, now);
    return { createdAt: r.createdAt, triage: t, item: {
      id: r.id, adId: ad.id, headline: ad.headline ?? '', caption: ad.caption, account: ad.account.name, product: ad.product.titleAr, format: ad.format, formatAr: FORMAT_AR[ad.format] ?? ad.format,
      img: ad.media.find((m) => m.role === 'FINAL')?.storageKey ?? null, video: ad.format === 'REEL_VIDEO' ? ad.media.find((m) => m.role === 'VIDEO')?.storageKey ?? null : null,
      slides: ad.media.filter((m) => m.role === 'SLIDE').length, verdict, verdictAr: QC_VERDICT_AR[verdict], reasonAr: REASON[r.reason] ?? r.reason, reasonCode: r.reason, note: r.note,
      failed: (qc?.checks.filter((c) => !c.passed) ?? []).map((c) => ({ id: c.id, label: c.label, ...(c.detail ? { detail: c.detail } : {}) })),
      publishable: !!qc?.publishable, qcPassed: ad.qcPassed, dryRun: ad.dryRun, algo, rubric: typeof rubric === 'number' ? rubric : null,
      lane: t.lane, quality: t.quality, qualitySource: t.qualitySource, wait: waitLabel(t.waitHours), createdLabel: fmtLocal(r.createdAt),
    } satisfies QueueItem };
  })).map((x) => x.item);
  const oldest = items[0] ? waitLabel((now.getTime() - items[0].createdAt.getTime()) / 3600_000) : null;
  return (
    <>
      <PageHeader title="طابور الموافقات" subtitle="راجع كل تصميم ونصه قبل النشر. «نشر» يعتمد التصميم ويرسله لأقرب وقت آمن (بفاصل 30 دقيقة لكل حساب)." />
      {ready > 1 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-3">
          <span className="text-sm font-bold text-emerald-900">{ready} تصميم جاهز اجتاز فحص الجودة</span>
          <ActionButton url="/api/approvals/publish-all" label={`✓ اعتماد ونشر الكل (${ready})`} variant="success" confirm={`نشر ${ready} تصميم؟ يُوزَّع النشر بفاصل 30 دقيقة لكل حساب. راجع الصور أولًا.`} />
        </div>
      )}
      {!items.length && !stuck.length && <Empty>لا توجد عناصر بانتظار الموافقة. 🎉</Empty>}
      {stuck.length > 0 && (
        <section className="mb-5 rounded-2xl border-2 border-amber-200 bg-amber-50 p-3">
          <h2 className="mb-1 text-sm font-extrabold text-amber-900">متوقفة بحالة «فشل» لكن ملفاتها جاهزة ({stuck.length})</h2>
          <p className="mb-3 text-xs text-amber-800">توقفت خطوة متأخرة (مثل نفاد ذاكرة السيرفر) بعد اكتمال التصميم. شاهدها، ثم «نشر الآن» أو أعد توليدها.</p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">{stuck.map((a) => {
            const img = a.media.find((m) => m.role === 'FINAL');
            const q = a.qcReport as unknown as QcReport | null;
            return (
              <div key={a.id} className="overflow-hidden rounded-xl border bg-white">
                <Link href={`/ads/${a.id}`}>{img && <img src={`/api/media/${img.storageKey}`} alt={a.headline ?? ''} className="aspect-[9/16] w-full bg-slate-900 object-cover" loading="lazy" />}</Link>
                <div className="space-y-1.5 p-2">
                  <div className="truncate text-xs font-bold">{a.headline}</div>
                  <div className="truncate text-[11px] text-slate-500">{a.account.name} · {FORMAT_AR[a.format] ?? a.format}</div>
                  {canPublishNow && <ActionButton url={`/api/ads/${a.id}/publish-now`} body={{ overrideQc: !q?.publishable }} label="🚀 نشر الآن" variant="gold" size="sm" block success="أُرسل للنشر — سيُنشر في أقرب وقت آمن" confirm="شاهدت التصميم وتأكدت من النص والأرقام والشعار؟ سيُرسل للنشر في أقرب وقت آمن." />}
                  <Link href={`/ads/${a.id}`} className="block text-center text-[11px] font-bold text-navy-700 underline">عرض / إعادة التوليد</Link>
                </div>
              </div>
            );
          })}</div>
        </section>
      )}
      {items.length > 0 && <p className="mb-3 text-xs text-slate-500">{pendingTotal} بانتظار قرارك{oldest ? ` · الأقدم ينتظر ${oldest.replace('منذ ', '')}` : ''} · بالمراجعة السريعة يستغرق كل تصميم ثوانٍ</p>}
      {items.length > 0 && <ApprovalQueue items={queue} canPublish={canPublish} totalPending={pendingTotal} />}
    </>
  );
}
