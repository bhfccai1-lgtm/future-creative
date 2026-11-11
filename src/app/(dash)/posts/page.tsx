import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/server';
import { Card, PageHeader, Empty } from '@/components/ui';
import { StateBadge, PLATFORM_AR } from '@/components/state-badge';
import { fmtLocal } from '@/lib/time';
import type { AdState } from '@prisma/client';
import { ActionButton } from '@/components/action-button';

export default async function PostsPage({ searchParams }: { searchParams: Promise<{ state?: string; account?: string }> }) {
  await requirePageUser();
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
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead><tr><th className="th">الموعد</th><th className="th">الحساب</th><th className="th">الإعلان</th><th className="th">الحالة</th><th className="th">معرّف المزود</th><th className="th">التحقق</th><th className="th">المحاولات</th><th className="th">الخطأ</th></tr></thead>
            <tbody>{jobs.map((j) => (
              <tr key={j.id} className="border-t">
                <td className="td text-xs">{fmtLocal(j.scheduledFor)}</td>
                <td className="td">{j.account.name}<div className="text-xs text-slate-500">{PLATFORM_AR[j.account.platform]}</div></td>
                <td className="td"><Link className="text-navy-700 hover:underline" href={`/ads/${j.advertisementId}`}>{j.advertisement.headline}</Link></td>
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
      )}
    </>
  );
}
