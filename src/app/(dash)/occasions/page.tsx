import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/server';
import { Card, PageHeader, Badge } from '@/components/ui';
import { OCCASIONS } from '@/lib/creative/options';
import { OCCASION_CATEGORIES, marketOf, upcomingOccasions } from '@/lib/creative/planner';
import { OccasionCampaign } from '@/components/occasion-campaign';
import { fmtLocal } from '@/lib/time';
export const dynamic = 'force-dynamic';

export default async function OccasionsPage() {
  await requirePageUser();
  const now = new Date();
  const [accounts, cats, campaigns] = await Promise.all([
    prisma.socialAccount.findMany({ include: { connection: true }, orderBy: { createdAt: 'asc' } }),
    prisma.productCategory.findMany({ select: { id: true, nameAr: true, _count: { select: { products: { where: { active: true } } } } } }),
    prisma.campaign.findMany({ where: { active: true }, select: { name: true, direction: true, nextRunAt: true } }),
  ]);
  const byName = new Map(cats.filter((c) => c._count.products > 0).map((c) => [c.nameAr, c.id]));
  const list = upcomingOccasions(now, 150);
  const connected = accounts.filter((a) => a.connection?.status === 'CONNECTED');
  return (
    <>
      <PageHeader title="تقويم المناسبات" subtitle="المناسبات البحرينية والخليجية القادمة — جهّز حملتها مسبقًا بضغطة. التصاميم تتنوع تلقائيًا (الصيغة، الأسلوب، المنتجات) وتمر بالموافقة حسب وضع النشر. التواريخ الهجرية تقديرية (±1–2 يوم)." />
      <div className="space-y-4">
        {list.map((w) => {
          const o = OCCASIONS.find((x) => x.value === w.key);
          const title = `${o?.ar ?? w.key} ${new Intl.DateTimeFormat('en', { timeZone: 'Asia/Bahrain', year: 'numeric' }).format(w.peak)}`;
          const existing = campaigns.filter((c) => (c.direction as { occasion?: string } | null)?.occasion === w.key);
          const suggested = (OCCASION_CATEGORIES[w.key] ?? []).filter((n) => byName.has(n)).map((n) => ({ id: byName.get(n)!, name: n }));
          const eligible = connected.filter((a) => !w.market || marketOf(a) === w.market);
          const active = now >= w.from;
          return (
            <Card key={`${w.key}-${w.peak.toISOString()}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-extrabold text-navy-900">{o?.ar ?? w.key}</div>
                  <div className="text-sm text-slate-600">ذروتها {fmtLocal(w.peak)} · {w.daysToPeak > 0 ? `بعد ${w.daysToPeak} يومًا` : w.daysToPeak === 0 ? 'اليوم' : 'جارية'} · نافذة النشر من {fmtLocal(w.from)} إلى {fmtLocal(w.to)}</div>
                  {suggested.length > 0 && <div className="mt-1 text-xs text-slate-500">الفئات المقترحة: {suggested.map((c) => c.name).join('، ')}</div>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {w.market === 'KSA' && <Badge tone="blue">السوق السعودي</Badge>}
                  {active ? <Badge tone="green">النظام يضيفها تلقائيًا الآن</Badge> : <Badge>قادمة</Badge>}
                  {existing.length > 0 && <Badge tone="gold">لها حملة ✓</Badge>}
                </div>
              </div>
              <div className="mt-3">
                {existing.length ? <p className="text-xs text-emerald-700">حملة نشطة: {existing.map((c) => c.name).join('، ')}</p>
                  : <OccasionCampaign occasion={w.key} title={title} startAt={w.startAt.toISOString()} endAt={w.endAt.toISOString()} accounts={eligible.map((a) => ({ id: a.id, name: a.name }))} defaultAccounts={eligible.map((a) => a.id)} categories={suggested} />}
              </div>
            </Card>
          );
        })}
        {!list.length && <Card><p className="text-sm text-slate-500">لا توجد مناسبات خلال الأشهر الخمسة القادمة.</p></Card>}
      </div>
    </>
  );
}
