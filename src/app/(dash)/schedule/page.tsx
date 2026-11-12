import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/server';
import { getSettings } from '@/lib/settings';
import { Card, PageHeader, Badge } from '@/components/ui';
import { AutomationControls } from '@/components/automation-controls';
import { RecommendedSetup } from '@/components/recommended-setup';
import { CrossPromoSettings } from '@/components/cross-promo-settings';
import { GrowthSettings } from '@/components/growth-settings';
import { growthStatus } from '@/lib/growth/status';
import { StateBadge, ConnBadge } from '@/components/state-badge';
import { fmtLocal } from '@/lib/time';

export default async function SchedulePage() {
  await requirePageUser();
  const [s, accounts, slots, jobs] = await Promise.all([
    getSettings(),
    prisma.socialAccount.findMany({ include: { connection: true }, orderBy: { createdAt: 'asc' } }),
    prisma.publicationSchedule.findMany({ orderBy: { slotAt: 'desc' }, take: 30, include: { account: true, advertisement: { select: { id: true, state: true } } } }),
    prisma.publicationJob.findMany({ where: { state: { in: ['QUEUED', 'PUBLISHING', 'SCHEDULED', 'UNKNOWN'] } }, orderBy: { scheduledFor: 'asc' }, take: 50, include: { account: true, advertisement: true } }),
  ]);
  const auto = accounts.filter((a) => a.autoPublishEnabled);
  return (
    <>
      <PageHeader title="جدول النشر الآلي" subtitle="المجدول يستيقظ كل ساعة؛ لكل حساب فترة نشر مستقلة. لا يتم أي نشر تلقائي دون تفعيل صريح." />
      <Card title="⭐ الإعداد الموصى به — ضغطة واحدة لكل الحسابات" className="mb-6"><RecommendedSetup /></Card>
      <Card title="🚀 الانتشار السريع — ساعات الذروة وضاعف الناجح" className="mb-6"><GrowthSettings initial={await growthStatus()} /></Card>
      <Card title="الترويج المتبادل بين حساباتك (ستوري)" className="mb-6"><CrossPromoSettings cfg={s.publishing.crossPromo} accounts={accounts.map((a) => ({ id: a.id, name: a.name, promoteToIds: a.promoteToIds }))} /></Card>
      <Card title="التحكم في الأتمتة" className="mb-6">
        <AutomationControls s={s} accounts={accounts.map((a) => ({ id: a.id, name: a.name, eligible: a.autoPublishEnabled && a.connection?.status === 'CONNECTED' && !a.paused, reason: !a.connection || a.connection.status === 'NOT_CONNECTED' ? 'غير مرتبط بـ Metricool' : a.connection.status !== 'CONNECTED' || !a.connection.canPublish ? `الربط منقطع (${a.connection.status})` : a.paused ? 'موقوف طارئًا' : !a.autoPublishEnabled ? 'مرتبط ✓ — النشر الآلي غير مسموح بعد' : null, connected: a.connection?.status === 'CONNECTED' && !!a.connection.canPublish, everyHours: Math.round((a.publishIntervalMinutes / 60) * 10) / 10, autonomous: a.autonomousAuthorized }))} />
      </Card>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title={`الحسابات المسموح لها بالنشر الآلي (${auto.length})`}>
          {auto.length ? (
            <table className="w-full"><tbody>{auto.map((a) => <tr key={a.id} className="border-t"><td className="td"><Link className="hover:underline" href={`/accounts/${a.id}`}>{a.name}</Link></td><td className="td"><ConnBadge status={a.connection?.status} /></td><td className="td text-xs">كل {a.publishIntervalMinutes} د · {a.publishWindowStart}–{a.publishWindowEnd}</td><td className="td text-xs">التالي: {fmtLocal(a.nextPublishAt)}</td><td className="td">{a.autonomousAuthorized && <Badge tone="red">ذاتي</Badge>}</td></tr>)}</tbody></table>
          ) : <p className="text-sm text-slate-500">لم يتم اختيار أي حساب. فعّل «السماح بالنشر الآلي» من صفحة كل حساب مرتبط.</p>}
        </Card>
        <Card title="مهام النشر الجارية">
          <table className="w-full"><tbody>{jobs.map((j) => <tr key={j.id} className="border-t"><td className="td text-xs">{fmtLocal(j.scheduledFor)}</td><td className="td"><Link className="hover:underline" href={`/ads/${j.advertisementId}`}>{j.advertisement.headline}</Link><div className="text-xs text-slate-500">{j.account.name}</div></td><td className="td"><StateBadge state={j.state} /></td></tr>)}</tbody></table>
          {!jobs.length && <p className="text-sm text-slate-500">لا توجد مهام جارية.</p>}
        </Card>
      </div>
      <Card title="فتحات المجدول الأخيرة" className="mt-6">
        <table className="w-full"><thead><tr><th className="th">الموعد</th><th className="th">الحساب</th><th className="th">الحالة</th><th className="th">الإعلان</th></tr></thead>
          <tbody>{slots.map((x) => <tr key={x.id} className="border-t"><td className="td text-xs">{fmtLocal(x.slotAt)}</td><td className="td">{x.account.name}</td><td className="td"><Badge tone={x.status === 'FAILED' ? 'red' : x.status === 'READY' ? 'green' : 'blue'}>{x.status}</Badge>{x.reason && <div className="text-xs text-red-700">{x.reason.slice(0, 120)}</div>}</td><td className="td">{x.advertisement ? <Link href={`/ads/${x.advertisement.id}`}><StateBadge state={x.advertisement.state} /></Link> : '—'}</td></tr>)}</tbody></table>
      </Card>
    </>
  );
}
