import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/server';
import { PageHeader, Badge, Empty } from '@/components/ui';
import { ActionButton } from '@/components/action-button';
import { fmtLocal } from '@/lib/time';
import { qcVerdict, QC_VERDICT_AR, type QcReport } from '@/lib/qc';

const REASON = { MANUAL_MODE: 'الوضع اليدوي', ASSISTED_MODE: 'الوضع المساعد', QC_FAILED: 'فشل فحص الجودة' } as Record<string, string>;
const FORMAT_AR: Record<string, string> = { REEL_VIDEO: 'ريلز', IMAGE_CAROUSEL: 'كاروسيل', IMAGE_FEED: 'منشور', IMAGE_SQUARE: 'مربع', IMAGE_STORY: 'ستوري' };

export default async function ApprovalsPage() {
  await requirePageUser();
  const items = await prisma.approvalRequest.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, include: { advertisement: { include: { media: true, account: true, product: true } } } });
  const ready = items.filter((r) => r.advertisement.qcPassed && !r.advertisement.dryRun && r.advertisement.state === 'QUALITY_REVIEW').length;
  return (
    <>
      <PageHeader title="طابور الموافقات" subtitle="راجع كل تصميم ونصه قبل النشر. «نشر» يعتمد التصميم ويرسله لأقرب وقت آمن (بفاصل 30 دقيقة لكل حساب)." />
      {ready > 1 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-3">
          <span className="text-sm font-bold text-emerald-900">{ready} تصميم جاهز اجتاز فحص الجودة</span>
          <ActionButton url="/api/approvals/publish-all" label={`✓ اعتماد ونشر الكل (${ready})`} variant="success" confirm={`نشر ${ready} تصميم؟ يُوزَّع النشر بفاصل 30 دقيقة لكل حساب. راجع الصور أولًا.`} />
        </div>
      )}
      {!items.length && <Empty>لا توجد عناصر بانتظار الموافقة. 🎉</Empty>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((r) => {
          const ad = r.advertisement;
          const img = ad.media.find((m) => m.role === 'FINAL');
          const video = ad.format === 'REEL_VIDEO' ? ad.media.find((m) => m.role === 'VIDEO') : null;
          const slides = ad.media.filter((m) => m.role === 'SLIDE').length;
          const qc = ad.qcReport as unknown as QcReport | null;
          const failed = qc?.checks.filter((c) => !c.passed) ?? [];
          const verdict = qcVerdict(qc);
          return (
            <article key={r.id} className="overflow-hidden rounded-2xl border bg-white shadow-sm">
              <div className="relative bg-slate-900">
                {video
                  ? <video className="aspect-[9/16] max-h-[52vh] w-full object-contain sm:max-h-[70vh]" src={`/api/media/${video.storageKey}`} poster={img ? `/api/media/${img.storageKey}` : undefined} controls playsInline preload="none" />
                  : img && <Link href={`/ads/${ad.id}`}><img className="max-h-[52vh] w-full object-contain sm:max-h-[70vh]" src={`/api/media/${img.storageKey}`} alt={ad.headline ?? ''} loading="lazy" /></Link>}
                <div className="absolute right-2 top-2 flex flex-wrap gap-1">
                  <Badge tone="navy">{FORMAT_AR[ad.format] ?? ad.format}{slides ? ` · ${slides + 1} شرائح` : ''}</Badge>
                  {ad.dryRun && <Badge tone="amber">تجريبي</Badge>}
                </div>
              </div>
              <div className="p-3">
                <div className="mb-1 flex flex-wrap gap-1">
                  <Badge tone={verdict === 'PASS' ? 'green' : verdict === 'REJECTED' ? 'red' : 'amber'}>الجودة: {QC_VERDICT_AR[verdict]}</Badge>
                  <Badge tone={r.reason === 'QC_FAILED' ? 'red' : 'blue'}>{REASON[r.reason] ?? r.reason}</Badge>
                </div>
                <div className="text-base font-extrabold text-navy-900">{ad.headline}</div>
                <div className="text-xs text-slate-500">{ad.account.name} · {ad.product.titleAr} · {fmtLocal(r.createdAt)}</div>
                {r.note && <p className="mt-1 text-xs text-slate-600">{r.note}</p>}
                {ad.caption && (
                  <details className="mt-2 rounded-lg bg-slate-50 p-2 text-sm">
                    <summary className="cursor-pointer text-xs font-bold text-navy-700">النص المرافق (اضغط للعرض)</summary>
                    <p className="mt-2 whitespace-pre-wrap text-slate-700">{ad.caption}</p>
                  </details>
                )}
                {failed.length > 0 && <ul className="mt-2 space-y-0.5 text-xs text-red-700">{failed.map((c) => <li key={c.id}>⛔ {c.label}{c.detail ? ` — ${c.detail}` : ''}</li>)}</ul>}
              </div>
              <div className="grid grid-cols-3 gap-2 border-t bg-slate-50 p-2">
                {qc?.publishable
                  ? <ActionButton url={`/api/ads/${ad.id}/publish-now`} label="✓ نشر" variant="success" size="lg" block success="أُرسل للنشر — سيُنشر في أقرب وقت آمن" />
                  : ad.qcPassed ? <ActionButton url={`/api/ads/${ad.id}/approve`} label="✓ اعتماد" variant="success" size="lg" block success="تم اعتماد التصميم" /> : <span />}
                <Link href={`/ads/${ad.id}`} className="flex items-center justify-center rounded-lg border bg-white text-sm font-bold text-navy-800">✎ تعديل</Link>
                <ActionButton url={`/api/ads/${ad.id}/reject`} label="✗ رفض" variant="danger" size="lg" block success="تم الرفض — سنتجنّب هذا الأسلوب" prompt="سبب الرفض (اختياري — يحسّن التصاميم القادمة)" promptKey="note" />
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
