import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/server';
import { Card, PageHeader, Badge, Empty } from '@/components/ui';
import { CampaignForm } from '@/components/campaign-form';
import { ActionButton } from '@/components/action-button';
import { PLATFORM_AR } from '@/components/state-badge';
import { directionSummaryAr, type Direction } from '@/lib/creative/options';
import { fmtLocal } from '@/lib/time';

const DAYS = ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];
const every = (h: number) => (h < 24 ? `كل ${h} س` : h === 24 ? 'يوميًا' : h === 168 ? 'أسبوعيًا' : `كل ${h / 24} أيام`);

export default async function CampaignsPage() {
  await requirePageUser('ads:create');
  const [campaigns, accounts, products] = await Promise.all([
    prisma.campaign.findMany({ orderBy: { createdAt: 'desc' }, include: { _count: { select: { schedules: true } } } }),
    prisma.socialAccount.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.product.findMany({ where: { active: true }, orderBy: { titleAr: 'asc' } }),
  ]);
  const accName = Object.fromEntries(accounts.map((a) => [a.id, a.name]));
  return (
    <>
      <PageHeader title="الحملات المتكررة" subtitle="إعلان بتصميم جديد في كل موعد — مرة واحدة أو كل عدد ساعات، في الأيام التي تختارها، بأفضل وقت أو بوقت تحدده" />
      <Card title="الحملات" className="mb-6">
        {!campaigns.length ? <Empty>لا توجد حملات بعد. أنشئ أول حملة من النموذج أدناه.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead><tr><th className="th">الحملة</th><th className="th">الحسابات</th><th className="th">الجدولة</th><th className="th">الموعد القادم</th><th className="th">نُفذت</th><th className="th">الحالة</th><th className="th"></th></tr></thead>
              <tbody>{campaigns.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="td"><div className="font-bold">{c.name}</div><div className="text-xs text-slate-500">{directionSummaryAr(c.direction as Direction).map(([, v]) => v).join(' · ')}</div></td>
                  <td className="td text-xs">{c.accountIds.slice(0, 3).map((id) => accName[id] ?? '؟').join('، ')}{c.accountIds.length > 3 ? ` +${c.accountIds.length - 3}` : ''}</td>
                  <td className="td text-xs">{c.scheduleType === 'ONCE' ? 'مرة واحدة' : `${every(c.everyHours)} · ${c.timeMode === 'BEST' ? 'أفضل وقت' : 'وقت محدد'}`}{c.daysOfWeek.length ? <div>{c.daysOfWeek.map((d) => DAYS[d]).join('، ')}</div> : null}{c.endAt ? <div>حتى {fmtLocal(c.endAt, undefined, 'yyyy-MM-dd')}</div> : null}</td>
                  <td className="td text-xs">{fmtLocal(c.nextRunAt)}</td>
                  <td className="td text-xs">{c.runs}{c.maxRuns ? ` / ${c.maxRuns}` : ''} موعد · {c._count.schedules} تصميم</td>
                  <td className="td">{c.active ? <Badge tone="green">نشطة</Badge> : <Badge>متوقفة</Badge>}</td>
                  <td className="td"><div className="flex gap-1">
                    <ActionButton url={`/api/campaigns/${c.id}`} method="PATCH" body={{ active: !c.active }} label={c.active ? 'إيقاف' : 'تشغيل'} variant="outline" size="sm" />
                    <ActionButton url={`/api/campaigns/${c.id}`} method="DELETE" label="حذف" variant="ghost" size="sm" confirm="حذف الحملة؟ التصاميم المولدة سابقًا تبقى في المكتبة." />
                  </div></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="حملة جديدة">
        <CampaignForm accounts={accounts.map((a) => ({ id: a.id, label: `${a.name} — ${PLATFORM_AR[a.platform]}` }))} products={products.map((p) => ({ id: p.id, label: p.titleAr }))} />
      </Card>
    </>
  );
}
