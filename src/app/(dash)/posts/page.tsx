import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/server';
import { Card, PageHeader, Empty } from '@/components/ui';
import { StateBadge, PLATFORM_AR } from '@/components/state-badge';
import { fmtLocal } from '@/lib/time';
import type { AdState } from '@prisma/client';
import { ActionButton } from '@/components/action-button';
import { DeleteAdButton } from '@/components/delete-ad-button';
import type { QcReport } from '@/lib/qc';

export default async function PostsPage({ searchParams }: { searchParams: Promise<{ state?: string; account?: string }> }) {
  const user = await requirePageUser();
  const canPublish = user.perms.includes('publish:now'), canEdit = user.perms.includes('ads:approve');
  const sp = await searchParams;
  const jobs = await prisma.publicationJob.findMany({
    where: { ...(sp.state ? { state: sp.state as AdState } : {}), ...(sp.account ? { accountId: sp.account } : {}) },
    orderBy: { scheduledFor: 'desc' }, take: 200, include: { account: true, advertisement: true, result: true, _count: { select: { attempts: true } } },
  });
  return (
    <>
      <PageHeader title="سجل المنشورات" subtitle="«منشور» يعني فقط أن المزود أكد النشر فعليًا. «مجدول» يعني أن المزود استلم الطلب ولم يؤكد النشر بعد." />
      <form className="mb-4 flex gap-2">
        <select name="state" defaultValue={sp.state ?? ''} className="input" style={{ width: "14rem" }}><option value="">كل الحالات</option>{['QUEUED', 'PUBLISHING', 'SCHEDULED', 'PUBLISHED', 'UNKNOWN', 'FAILED', 'REJECTED'].map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <button className="rounded-lg bg-navy-800 px-4 text-sm font-bold text-white">تصفية</button>
      </form>
      {!jobs.length ? <Empty>لا توجد سجلات نشر بعد.</Empty> : (
        <>
        {/* phones: one card per post — reason and actions always visible */}
        <div className="space-y-3 md:hidden">{jobs.map((j) => {
          const failedAd = j.state === 'FAILED' && j.advertisement.state === 'FAILED' && !j.advertisement.dryRun;
          return (
            <article key={j.id} className={`rounded-2xl border bg-white p-3 shadow-sm ${j.state === 'FAILED' ? 'border-red-200' : ''}`}>
              <div className="mb-1 flex items-start justify-between gap-2">
                <div className="min-w-0"><div className="truncate font-bold text-navy-900">{j.account.name}</div><div className="text-[11px] text-slate-500">{fmtLocal(j.scheduledFor)} · {(j.networks.length ? j.networks : [j.account.platform]).map((n) => PLATFORM_AR[n] ?? n).join(' + ')}{!j.primary && ' · نسخة مرافقة'}</div></div>
                <StateBadge state={j.state} />
              </div>
              <Link className="block text-sm font-bold text-navy-700 underline" href={`/ads/${j.advertisementId}`}>{j.advertisement.headline}</Link>
              {j.lastError && <p className="mt-1 rounded-lg bg-red-50 p-2 text-xs text-red-800">السبب: {j.lastError.slice(0, 200)}</p>}
              {j.result?.verifiedAt && <p className="mt-1 text-xs text-emerald-700">✅ {fmtLocal(j.result.verifiedAt)}{j.result.publicUrl && <> · <a className="underline" href={j.result.publicUrl} target="_blank" rel="noreferrer">فتح المنشور</a></>}</p>}
              {failedAd && (
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  {canPublish ? <ActionButton url={`/api/ads/${j.advertisementId}/publish-now`} body={{ overrideQc: !(j.advertisement.qcReport as unknown as QcReport | null)?.publishable }} label="🚀 نشر الآن" variant="gold" size="sm" block success="أُرسل للنشر — سيُنشر في أقرب وقت آمن" confirm={`إعادة نشر «${j.advertisement.headline ?? ''}» على ${j.account.name}؟\nالسبب السابق: ${(j.lastError ?? '—').slice(0, 120)}\nتأكد أن السبب زال قبل المحاولة.`} /> : <span />}
                  {canEdit ? <Link href={`/ads/${j.advertisementId}`} className="flex items-center justify-center rounded-lg border bg-white text-xs font-bold text-navy-800">✎ تعديل</Link> : <span />}
                  {canEdit ? <DeleteAdButton adId={j.advertisementId} headline={j.advertisement.headline} size="sm" block /> : <span />}
                </div>
              )}
              {j.state === 'UNKNOWN' && <div className="mt-2 flex flex-wrap gap-1.5">
                <ActionButton url={`/api/publication-jobs/${j.id}/resolve`} body={{ action: 'resubmit' }} size="sm" variant="outline" label="بحث ثم إعادة الإرسال" confirm="سيبحث النظام أولًا في Metricool؛ لن يُعاد الإرسال إلا إذا ثبت عدم وجود المنشور. متابعة؟" />
                <ActionButton url={`/api/publication-jobs/${j.id}/resolve`} body={{ action: 'cancel' }} size="sm" variant="ghost" label="إلغاء" confirm="إغلاق المهمة دون إرسال؟" />
              </div>}
            </article>
          );
        })}</div>
        <Card className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[900px]">
            <thead><tr><th className="th">الموعد</th><th className="th">الحساب</th><th className="th">الإعلان</th><th className="th">الحالة</th><th className="th">معرّف المزود</th><th className="th">التحقق</th><th className="th">المحاولات</th><th className="th">الخطأ</th></tr></thead>
            <tbody>{jobs.map((j) => (
              <tr key={j.id} className="border-t">
                <td className="td text-xs">{fmtLocal(j.scheduledFor)}</td>
                <td className="td">{j.account.name}<div className="text-xs text-slate-500">{(j.networks.length ? j.networks : [j.account.platform]).map((n) => PLATFORM_AR[n] ?? n).join(' + ')}{!j.primary && ' · نسخة مرافقة'}</div></td>
                <td className="td"><Link className="text-navy-700 hover:underline" href={`/ads/${j.advertisementId}`}>{j.advertisement.headline}</Link>
                  {j.state === 'FAILED' && j.advertisement.state === 'FAILED' && !j.advertisement.dryRun && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {canPublish && <ActionButton url={`/api/ads/${j.advertisementId}/publish-now`} body={{ overrideQc: !(j.advertisement.qcReport as unknown as QcReport | null)?.publishable }} label="🚀 نشر الآن" variant="gold" size="sm" success="أُرسل للنشر — سيُنشر في أقرب وقت آمن" confirm={`إعادة نشر «${j.advertisement.headline ?? ''}» على ${j.account.name}؟\nالسبب السابق: ${(j.lastError ?? '—').slice(0, 120)}\nتأكد أن السبب زال (الربط، الصلاحيات، حجم الملف) قبل المحاولة.`} />}
                      {canEdit && <Link href={`/ads/${j.advertisementId}`} className="inline-flex items-center rounded-lg border bg-white px-3 py-1 text-xs font-bold text-navy-800">✎ تعديل</Link>}
                      {canEdit && <DeleteAdButton adId={j.advertisementId} headline={j.advertisement.headline} size="sm" />}
                    </div>
                  )}
                </td>
                <td className="td"><StateBadge state={j.state} /></td>
                <td className="td ltr text-xs">{j.result?.providerPostId ?? '—'}</td>
                <td className="td text-xs">{j.result?.verifiedAt ? <>✅ {fmtLocal(j.result.verifiedAt)}{j.result.publicUrl && <> · <a className="underline" href={j.result.publicUrl} target="_blank" rel="noreferrer">فتح</a></>}</> : '—'}</td>
                <td className="td">{j._count.attempts}</td>
                <td className="td text-xs text-red-700">{j.lastError?.slice(0, 120)}
                  {j.state === 'UNKNOWN' && <div className="mt-1 flex gap-1">
                    <ActionButton url={`/api/publication-jobs/${j.id}/resolve`} body={{ action: 'resubmit' }} size="sm" variant="outline" label="بحث ثم إعادة الإرسال" confirm="سيبحث النظام أولًا في Metricool؛ لن يُعاد الإرسال إلا إذا ثبت عدم وجود المنشور. تأكد أيضًا من Metricool يدويًا. متابعة؟" />
                    <ActionButton url={`/api/publication-jobs/${j.id}/resolve`} body={{ action: 'cancel' }} size="sm" variant="ghost" label="إلغاء" confirm="إغلاق المهمة دون إرسال؟" />
                  </div>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
        </>
      )}
    </>
  );
}
