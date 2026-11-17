import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/server';
import { getSettings } from '@/lib/settings';
import { Card, PageHeader, Badge } from '@/components/ui';
import { OCCASIONS, type OccasionScope } from '@/lib/creative/options';
import { OCCASION_CATEGORIES, marketOf, upcomingOccasions } from '@/lib/creative/planner';
import { OccasionCampaign } from '@/components/occasion-campaign';
import { ActionButton } from '@/components/action-button';
import { fmtLocal } from '@/lib/time';
export const dynamic = 'force-dynamic';

const SCOPES: [OccasionScope | 'all', string][] = [['all', 'الكل'], ['BH', '🇧🇭 بحرينية ودينية'], ['GCC', 'خليجية'], ['GLOBAL', '🌍 عالمية'], ['COMMUNITY', 'الجاليات']];
const SCOPE_BADGE: Record<OccasionScope, { ar: string; tone: 'red' | 'green' | 'blue' | 'amber' }> = {
  BH: { ar: 'بحرينية', tone: 'red' }, GCC: { ar: 'خليجية', tone: 'green' }, GLOBAL: { ar: 'عالمية', tone: 'blue' }, COMMUNITY: { ar: 'الجاليات', tone: 'amber' },
};
const monthAr = (d: Date) => new Intl.DateTimeFormat('ar-BH', { timeZone: 'Asia/Bahrain', month: 'long', year: 'numeric' }).format(d);
const scopeOf = (key: string): OccasionScope => OCCASIONS.find((o) => o.value === key)?.scope ?? 'GLOBAL';

export default async function OccasionsPage({ searchParams }: { searchParams: Promise<{ scope?: string; range?: string }> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const scope = SCOPES.find(([k]) => k === sp.scope)?.[0] ?? 'all';
  const year = sp.range === 'year';
  const now = new Date();
  const [s, accounts, cats, campaigns] = await Promise.all([
    getSettings(),
    prisma.socialAccount.findMany({ include: { connection: true }, orderBy: { createdAt: 'asc' } }),
    prisma.productCategory.findMany({ select: { id: true, nameAr: true, _count: { select: { products: { where: { active: true } } } } } }),
    prisma.campaign.findMany({ where: { active: true }, select: { name: true, direction: true, nextRunAt: true } }),
  ]);
  const byName = new Map(cats.filter((c) => c._count.products > 0).map((c) => [c.nameAr, c.id]));
  const all = upcomingOccasions(now, year ? 366 : 150);
  const list = all.filter((w) => scope === 'all' || scopeOf(w.key) === scope);
  const connected = accounts.filter((a) => a.connection?.status === 'CONNECTED');
  const canToggle = user.perms.includes('automation:control');
  const q = (o: { scope?: string; year?: boolean }) => `/occasions?scope=${o.scope ?? scope}${(o.year ?? year) ? '&range=year' : ''}`;
  let lastMonth = '';
  return (
    <>
      <PageHeader title="تقويم المناسبات" subtitle={`${OCCASIONS.length - 1} مناسبة بحرينية وخليجية وعالمية وللجاليات — جهّز حملتها مسبقًا بضغطة، أو أوقف ما لا يناسب نشاطك. التواريخ الهجرية تقديرية (±1–2 يوم).`} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <nav className="flex flex-wrap gap-1.5 text-sm" aria-label="نوع المناسبة">
          {SCOPES.map(([k, ar]) => {
            const n = k === 'all' ? all.length : all.filter((w) => scopeOf(w.key) === k).length;
            return <Link key={k} href={q({ scope: k })} className={`rounded-full border px-3 py-1.5 font-bold ${scope === k ? 'border-navy-800 bg-navy-800 text-white' : 'bg-white text-slate-700'}`}>{ar} <span className="opacity-70">{n}</span></Link>;
          })}
        </nav>
        <Link href={q({ year: !year })} className="mr-auto text-sm font-bold text-gold-600 underline">{year ? 'الأشهر الخمسة القادمة' : 'عرض السنة كاملة'}</Link>
      </div>
      <div className="space-y-3">
        {list.map((w) => {
          const o = OCCASIONS.find((x) => x.value === w.key);
          const sc = scopeOf(w.key);
          const off = s.disabledOccasions.includes(w.key);
          const title = `${o?.ar ?? w.key} ${new Intl.DateTimeFormat('en', { timeZone: 'Asia/Bahrain', year: 'numeric' }).format(w.peak)}`;
          const existing = campaigns.filter((c) => (c.direction as { occasion?: string } | null)?.occasion === w.key);
          const suggested = (OCCASION_CATEGORIES[w.key] ?? []).filter((n) => byName.has(n)).map((n) => ({ id: byName.get(n)!, name: n }));
          const eligible = connected.filter((a) => !w.market || marketOf(a) === w.market);
          const active = now >= w.from;
          const m = monthAr(w.peak);
          const header = m !== lastMonth ? (lastMonth = m) : null;
          return (
            <div key={`${w.key}-${w.peak.toISOString()}`}>
              {header && <h2 className="mb-2 mt-5 text-sm font-extrabold text-slate-500">{header}</h2>}
              <Card className={off ? 'opacity-60' : ''}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-lg font-extrabold text-navy-900">{o?.ar ?? w.key}</div>
                    <div className="text-sm text-slate-600">ذروتها {fmtLocal(w.peak)} · {w.daysToPeak > 0 ? `بعد ${w.daysToPeak} يومًا` : w.daysToPeak === 0 ? 'اليوم' : 'جارية'}</div>
                    {o?.headlineAr && <div className="mt-1 text-sm text-navy-700">💡 عنوان مقترح: «{o.headlineAr}»</div>}
                    {suggested.length > 0 && <div className="mt-1 text-xs text-slate-500">الفئات المقترحة: {suggested.map((c) => c.name).join('، ')}</div>}
                    {w.langs && <div className="mt-1 text-xs text-slate-500">للحسابات بلغة: {w.langs.map((l) => ({ ar: 'العربية', en: 'الإنجليزية', ml: 'المالايالامية' } as Record<string, string>)[l] ?? l).join('، ')}</div>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={SCOPE_BADGE[sc].tone}>{SCOPE_BADGE[sc].ar}</Badge>
                    {w.market === 'KSA' && <Badge tone="blue">السوق السعودي</Badge>}
                    {off ? <Badge>متوقفة</Badge> : active ? <Badge tone="green">النظام يضيفها تلقائيًا الآن</Badge> : <Badge>قادمة</Badge>}
                    {existing.length > 0 && <Badge tone="gold">لها حملة ✓</Badge>}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  {off ? null : existing.length ? <p className="text-xs text-emerald-700">حملة نشطة: {existing.map((c) => c.name).join('، ')}</p>
                    : <OccasionCampaign occasion={w.key} title={title} startAt={w.startAt.toISOString()} endAt={w.endAt.toISOString()} accounts={eligible.map((a) => ({ id: a.id, name: a.name }))} defaultAccounts={eligible.map((a) => a.id)} categories={suggested} />}
                  {canToggle && <ActionButton url="/api/occasions/toggle" body={{ key: w.key, enabled: off }} size="sm" variant={off ? 'outline' : 'ghost'} label={off ? 'تفعيل المناسبة' : 'إيقاف — لا تناسب نشاطي'} success={off ? 'فُعّلت ✓' : 'أُوقفت ✓'} />}
                </div>
              </Card>
            </div>
          );
        })}
        {!list.length && <Card><p className="text-sm text-slate-500">لا توجد مناسبات من هذا النوع في الفترة المعروضة — جرّب «عرض السنة كاملة».</p></Card>}
      </div>
    </>
  );
}
