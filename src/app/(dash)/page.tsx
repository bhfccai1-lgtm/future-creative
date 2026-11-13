import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/settings';
import { startOfDayInTz, fmtLocal } from '@/lib/time';
import { estimateAdCost, monthToDateSpend } from '@/lib/ai/cost';
import { Card, PageHeader, Stat, buttonVariants } from '@/components/ui';
import { StateBadge, PLATFORM_AR } from '@/components/state-badge';
import { ActionButton } from '@/components/action-button';

export default async function Dashboard() {
  const s = await getSettings();
  const today = startOfDayInTz();
  const [connected, autoAccounts, genToday, publishedToday, scheduled, failed, pending, nextJob, nextAcc, spend, recent, perAccount] = await Promise.all([
    prisma.socialConnection.count({ where: { status: 'CONNECTED' } }),
    prisma.socialAccount.count({ where: { autoPublishEnabled: true } }),
    prisma.advertisement.count({ where: { createdAt: { gte: today } } }),
    prisma.publicationJob.count({ where: { state: 'PUBLISHED', result: { verifiedAt: { gte: today } } } }),
    prisma.publicationJob.count({ where: { state: { in: ['QUEUED', 'SCHEDULED'] } } }),
    prisma.publicationJob.count({ where: { state: { in: ['FAILED', 'UNKNOWN'] } } }),
    prisma.approvalRequest.count({ where: { status: 'PENDING' } }),
    prisma.publicationJob.findFirst({ where: { state: { in: ['QUEUED', 'SCHEDULED'] }, scheduledFor: { gte: new Date() } }, orderBy: { scheduledFor: 'asc' } }),
    prisma.socialAccount.findFirst({ where: { autoPublishEnabled: true, nextPublishAt: { not: null } }, orderBy: { nextPublishAt: 'asc' } }),
    monthToDateSpend(),
    prisma.advertisement.findMany({ orderBy: { createdAt: 'desc' }, take: 8, include: { account: true, product: true } }),
    prisma.socialAccount.findMany({ include: { _count: { select: { advertisements: true } }, jobs: { where: { state: 'PUBLISHED' }, select: { id: true } } }, orderBy: { createdAt: 'asc' }, take: 20 }),
  ]);
  const newIdeas = await prisma.idea.count({ where: { status: 'NEW' } });
  const next = [nextJob?.scheduledFor, nextAcc?.nextPublishAt].filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0];
  const budgetPct = spend / Math.max(0.01, s.ai.monthlyBudgetUsd);
  return (
    <>
      <PageHeader title="لوحة التحكم" subtitle="نظرة عامة على الإنتاج والنشر — الأرقام مأخوذة من قاعدة البيانات مباشرة"
        actions={<>
          <Link href="/create" className={buttonVariants({ variant: 'gold', size: 'lg' })}>إنشاء إعلان الآن</Link>
          {s.autoPublishGlobal
            ? <ActionButton url="/api/automation" body={{ action: 'stop' }} label="إيقاف النشر الآلي" variant="outline" size="lg" />
            : <ActionButton url="/api/automation" body={{ action: 'start' }} label="تشغيل النشر الآلي" variant="success" size="lg" confirm="سيبدأ المجدول بالعمل كل ساعة للحسابات المفعّلة فقط. متابعة؟" />}
        </>} />
      {(pending > 0 || failed > 0 || newIdeas > 0) && (
        <div className="mb-5">
          <div className="mb-2 text-sm font-extrabold text-navy-800">يحتاج قرارك الآن</div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {pending > 0 && <Link href="/approvals" className="flex items-center justify-between rounded-2xl border-2 border-gold-400 bg-gold-300/20 p-4"><span className="font-bold text-navy-900">✋ تصاميم بانتظار موافقتك</span><span className="rounded-full bg-gold-500 px-3 py-1 text-lg font-extrabold text-navy-950">{pending}</span></Link>}
            {failed > 0 && <Link href="/posts?state=FAILED" className="flex items-center justify-between rounded-2xl border-2 border-red-200 bg-red-50 p-4"><span className="font-bold text-red-900">⚠️ نشر فاشل أو غير مؤكد</span><span className="rounded-full bg-red-600 px-3 py-1 text-lg font-extrabold text-white">{failed}</span></Link>}
            {newIdeas > 0 && <Link href="/ideas" className="flex items-center justify-between rounded-2xl border-2 border-sky-200 bg-sky-50 p-4"><span className="font-bold text-sky-900">💡 أفكار جديدة للمراجعة</span><span className="rounded-full bg-sky-600 px-3 py-1 text-lg font-extrabold text-white">{newIdeas}</span></Link>}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-5">
        <Stat label="الحسابات المرتبطة (مؤكدة)" value={connected} />
        <Stat label="حسابات النشر الآلي النشطة" value={autoAccounts} tone="gold" />
        <Stat label="إعلانات مولدة اليوم" value={genToday} />
        <Stat label="منشورة بنجاح اليوم (مؤكد)" value={publishedToday} tone="green" />
        <Stat label="إعلانات مجدولة" value={scheduled} />
        <Stat label="نشر فاشل / غير مؤكد" value={failed} tone="red" />
        <Stat label="بانتظار الموافقة" value={pending} tone="gold" hint={<Link className="underline" href="/approvals">فتح الطابور</Link>} />
        <Stat label="موعد النشر التالي" value={<span className="text-lg">{fmtLocal(next ?? null)}</span>} />
        <Stat label="تكلفة الذكاء الاصطناعي هذا الشهر" value={<span className="ltr">${spend.toFixed(2)}</span>} hint={`الحد: $${s.ai.monthlyBudgetUsd} · التقدير لكل إعلان: $${estimateAdCost(s).toFixed(3)}`} tone={budgetPct > 0.8 ? 'red' : 'navy'} />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card title="أحدث الإعلانات">
          <div className="overflow-x-auto"><table className="w-full"><tbody>
            {recent.map((a) => (
              <tr key={a.id} className="border-t"><td className="td"><Link className="font-bold text-navy-700 hover:underline" href={`/ads/${a.id}`}>{a.headline ?? a.product.titleAr}</Link><div className="text-xs text-slate-500">{a.account.name} · {fmtLocal(a.createdAt)}</div></td><td className="td"><StateBadge state={a.state} /></td></tr>
            ))}
            {!recent.length && <tr><td className="td text-slate-500">لا توجد إعلانات بعد.</td></tr>}
          </tbody></table></div>
        </Card>
        <Card title="أداء الحسابات">
          <table className="w-full"><thead><tr><th className="th">الحساب</th><th className="th">المنصة</th><th className="th">الإعلانات</th><th className="th">منشور مؤكد</th></tr></thead><tbody>
            {perAccount.map((a) => <tr key={a.id} className="border-t"><td className="td"><Link className="hover:underline" href={`/accounts/${a.id}`}>{a.name}</Link></td><td className="td">{PLATFORM_AR[a.platform]}</td><td className="td">{a._count.advertisements}</td><td className="td">{a.jobs.length}</td></tr>)}
          </tbody></table>
        </Card>
      </div>
    </>
  );
}
