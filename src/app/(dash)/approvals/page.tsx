import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/server';
import { PageHeader, Badge, Empty } from '@/components/ui';
import { ActionButton } from '@/components/action-button';
import { fmtLocal } from '@/lib/time';
import { qcVerdict, QC_VERDICT_AR, type QcReport } from '@/lib/qc';
import { algoInputFromAd, algorithmScore } from '@/lib/growth/algorithm';

const REASON = { MANUAL_MODE: 'الوضع اليدوي', ASSISTED_MODE: 'الوضع المساعد', QC_FAILED: 'فشل فحص الجودة' } as Record<string, string>;
const FORMAT_AR: Record<string, string> = { REEL_VIDEO: 'ريلز', IMAGE_CAROUSEL: 'كاروسيل', IMAGE_FEED: 'منشور', IMAGE_SQUARE: 'مربع', IMAGE_STORY: 'ستوري' };

const LIST_MAX = 100; // a long queue would load every design with its media at once

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
  return (
    <>
      <PageHeader title="طابور الموافقات" subtitle="راجع كل تصميم ونصه قبل النشر. «نشر» يعتمد التصميم ويرسله لأقرب وقت آمن (بفاصل 30 دقيقة لكل حساب)." />
      {ready > 1 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-3">
          <span className="text-sm font-bold text-emerald-900">{ready} تصميم جاهز اجتاز فحص الجودة</span>
          <ActionButton url="/api/approvals/publish-all" label={`✓ اعتماد ونشر الكل (${ready})`} variant="success" confirm={`نشر ${ready} تصميم؟ يُوزَّع النشر بفاصل 30 دقيقة لكل حساب. راجع الصور أولًا.`} />
        </div>
      )}
      {pendingTotal > items.length && <p className="mb-3 text-xs text-slate-500">يظهر أقدم {items.length} من {pendingTotal} تصميمًا بانتظار الموافقة — اعتمد أو ارفض لتظهر البقية.</p>}
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
                  {(() => { const a = algorithmScore(algoInputFromAd(ad)); return <Badge tone={a.score >= 85 ? 'green' : a.score >= 70 ? 'blue' : 'amber'}>📈 الخوارزمية {a.score}</Badge>; })()}
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
                  : !ad.dryRun && canPublish ? <ActionButton url={`/api/ads/${ad.id}/publish-now`} body={{ overrideQc: true }} label="⚠ نشر الآن" variant="gold" size="lg" block success="أُرسل للنشر رغم ملاحظات الجودة — سُجّل باسمك"
                      confirm={`نشر هذا التصميم بدون اجتياز فحص الجودة؟\n\nالملاحظات:\n${failed.map((c) => `• ${c.label}`).join('\n') || '• يحتاج مراجعة بشرية'}\n\nتأكد بنفسك من النص والأرقام والشعار. يُسجَّل القرار باسمك.`}
                      prompt="سبب النشر رغم الملاحظات (اختياري)" promptKey="reason" />
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
