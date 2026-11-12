import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/server';
import { Card, PageHeader, Badge, Empty } from '@/components/ui';
import { CampaignForm } from '@/components/campaign-form';
import { CampaignUpgrade } from '@/components/campaign-upgrade';
import Link from 'next/link';
import { ActionButton } from '@/components/action-button';
import { PLATFORM_AR } from '@/components/state-badge';
import { directionSummaryAr, type Direction } from '@/lib/creative/options';
import { fmtLocal } from '@/lib/time';

const DAYS = ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];
const every = (h: number) => (h < 24 ? `كل ${h} س` : h === 24 ? 'يوميًا' : h === 168 ? 'أسبوعيًا' : `كل ${h / 24} أيام`);

export default async function CampaignsPage() {
  await requirePageUser('ads:create');
  const [campaigns, accounts, products, categories] = await Promise.all([
    prisma.campaign.findMany({ orderBy: { createdAt: 'desc' }, include: { _count: { select: { schedules: true } } } }),
    prisma.socialAccount.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.product.findMany({ where: { active: true }, orderBy: { titleAr: 'asc' } }),
    prisma.productCategory.findMany({ orderBy: { nameAr: 'asc' }, select: { id: true, nameAr: true, _count: { select: { products: { where: { active: true } } } } } }),
  ]);
  const accName = Object.fromEntries(accounts.map((a) => [a.id, a.name]));
  return (
    <>
      <PageHeader title="الحملات المتكررة" subtitle="إعلان بتصميم جديد في كل موعد — مرة واحدة أو كل عدد ساعات، في الأيام التي تختارها، بأفضل وقت أو بوقت تحدده" />
      <Card title="الحملات" className="mb-6">
        {!campaigns.length ? <Empty>لا توجد حملات بعد. أنشئ أول حملة من النموذج أدناه.</Empty> : (
          <div className="grid gap-3 lg:grid-cols-2">
            {campaigns.map((c) => (
              <div key={c.id} className={`rounded-xl border p-3 ${c.active ? 'bg-white' : 'bg-slate-50'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="font-extrabold text-navy-900">{c.name}</div>
                  {c.active ? <Badge tone="green">نشطة</Badge> : <Badge>متوقفة</Badge>}
                </div>
                <div className="mt-1 text-xs text-slate-600">{directionSummaryAr(c.direction as Direction).map(([, v]) => v).join(' · ') || 'كل الاختيارات تلقائية'}</div>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <div><span className="text-slate-500">الحسابات: </span>{c.accountIds.slice(0, 4).map((id) => accName[id] ?? '؟').join('، ')}{c.accountIds.length > 4 ? ` +${c.accountIds.length - 4}` : ''}</div>
                  <div><span className="text-slate-500">الجدولة: </span>{c.scheduleType === 'ONCE' ? 'مرة واحدة' : `${every(c.everyHours)} · ${c.timeMode === 'BEST' ? 'أفضل وقت' : 'وقت محدد'}`}{c.daysOfWeek.length ? ` · ${c.daysOfWeek.map((d) => DAYS[d]).join('، ')}` : ''}{c.endAt ? ` · حتى ${fmtLocal(c.endAt, undefined, 'yyyy-MM-dd')}` : ''}</div>
                  <div><span className="text-slate-500">القادم: </span>{c.active ? fmtLocal(c.nextRunAt) : '—'}</div>
                  <div><span className="text-slate-500">نُفذت: </span>{c.runs}{c.maxRuns ? ` / ${c.maxRuns}` : ''} موعد · {c._count.schedules} تصميم</div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  <Link href={`/campaigns/${c.id}`} className="rounded-lg bg-navy-800 px-3 py-1 text-xs font-bold text-white">تعديل</Link>
                  <ActionButton url={`/api/campaigns/${c.id}`} method="PATCH" body={{ active: !c.active }} label={c.active ? 'إيقاف' : 'تشغيل'} variant="outline" size="sm" />
                  <ActionButton url={`/api/campaigns/${c.id}/duplicate`} method="POST" label="نسخ" variant="outline" size="sm" />
                  <ActionButton url={`/api/campaigns/${c.id}`} method="DELETE" label="حذف" variant="ghost" size="sm" confirm="حذف الحملة؟ التصاميم المولدة سابقًا تبقى في المكتبة." />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      {campaigns.length > 0 && <Card title="ترقية الحملات القديمة للميزات الجديدة" className="mb-6"><CampaignUpgrade /></Card>}
      <Card title="حملة جديدة">
        <CampaignForm accounts={accounts.map((a) => ({ id: a.id, label: `${a.name} — ${PLATFORM_AR[a.platform]}` }))} products={products.map((p) => ({ id: p.id, label: p.titleAr, categoryId: p.categoryId }))} categories={categories.filter((c) => c._count.products > 0).map((c) => ({ id: c.id, label: `${c.nameAr} (${c._count.products})` }))} />
      </Card>
    </>
  );
}
