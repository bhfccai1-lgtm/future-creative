import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/server';
import { Badge, Card, PageHeader, Stat } from '@/components/ui';
import { ActionButton } from '@/components/action-button';
import { LeadForm } from '@/components/lead-form';
import { leadStats, leadsFromComments, LOST_REASONS, salesOverview, SOURCE_AR, STATUS_AR, STATUSES, type LeadStatus } from '@/lib/leads/service';
import { nextAction, scriptText, waLink, type Quote, type Touch } from '@/lib/leads/scripts';
import { SalesAction } from '@/components/sales-action';
import { SalesSettings } from '@/components/sales-settings';
import { getSettings } from '@/lib/settings';
import { contactLines, getBusiness } from '@/lib/business';
import { customerKey, customerProfiles, priorProfile, scoreLead, TIER_AR, todayPriorities, type Tier } from '@/lib/leads/intel';
export const dynamic = 'force-dynamic';

const TIER_TONE: Record<Tier, 'red' | 'amber' | 'slate'> = { hot: 'red', warm: 'amber', cold: 'slate' };
const TONE: Record<LeadStatus, 'blue' | 'amber' | 'gold' | 'green' | 'slate'> = { NEW: 'blue', CONTACTED: 'amber', QUOTED: 'gold', WON: 'green', LOST: 'slate' };
const ago = (d: Date) => { const h = (Date.now() - d.getTime()) / 3600_000; return h < 1 ? 'الآن' : h < 24 ? `قبل ${Math.round(h)} س` : `قبل ${Math.round(h / 24)} يوم`; };
const bhd = (n: number) => `${n.toLocaleString('en-US', { maximumFractionDigits: 3 })} د.ب`;

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const user = await requirePageUser();
  const canEdit = user.perms.includes('ads:approve');
  await leadsFromComments().catch(() => 0); // catch up comments analysed before this feature
  const sp = await searchParams;
  const tab = (STATUSES as readonly string[]).includes(sp.s ?? '') ? (sp.s as LeadStatus) : 'open';
  const [stats, list, accounts, products, counts, sales, settings, business] = await Promise.all([
    leadStats(30),
    prisma.lead.findMany({ where: tab === 'open' ? { status: { in: ['NEW', 'CONTACTED', 'QUOTED'] } } : { status: tab }, orderBy: tab === 'open' ? [{ nextFollowUpAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }] : { updatedAt: 'desc' }, take: 100, include: { account: { select: { name: true } }, product: { select: { titleAr: true } } } }),
    prisma.socialAccount.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.product.findMany({ where: { active: true }, select: { id: true, titleAr: true }, orderBy: { titleAr: 'asc' }, take: 300 }),
    prisma.lead.groupBy({ by: ['status'], _count: true }),
    salesOverview(), getSettings(), getBusiness(),
  ]);
  // 🧠 customer profiles (all requests of the same number) + a score per open request, and today's priorities
  const [profiles, today] = await Promise.all([customerProfiles(list.map((l) => l.contact)), tab === 'open' ? todayPriorities() : Promise.resolve([])]);
  const ctx = { business: business.nameAr, branches: contactLines(business, 'ar'), reactivationDays: settings.sales.reactivationDays };
  const canSettings = user.perms.includes('accounts:manage');
  const n = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;
  const tabs: [string, string, number][] = [['open', 'المفتوحة', n('NEW') + n('CONTACTED') + n('QUOTED')], ['WON', STATUS_AR.WON, n('WON')], ['LOST', STATUS_AR.LOST, n('LOST')]];
  const now = Date.now();
  return (
    <>
      <PageHeader title="العملاء والطلبات" subtitle="كل استفسار يُتابَع حتى يصبح طلبًا: تعليقات الشراء والسعر تُضاف تلقائيًا، وأضف من اتصل أو راسل أو زار الفرع. هكذا تعرف أي حساب يجلب الطلبات فعلًا." />
      <Card className="mb-4" title="🎯 مبيعات هذا الشهر">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="md:col-span-2">
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2"><span className="text-2xl font-extrabold text-navy-900">{bhd(sales.month.revenue)}</span><span className="text-sm text-slate-600">{sales.month.target ? `من هدف ${bhd(sales.month.target)} · ${sales.month.pct}%` : 'حدّد هدفًا شهريًا من الإعدادات أدناه'}</span></div>
            {sales.month.target > 0 && <>
              <div className="relative h-3 rounded bg-slate-100"><div className={`h-3 rounded ${sales.month.revenue >= sales.month.expectedByNow ? 'bg-emerald-500' : 'bg-gold-500'}`} style={{ width: `${Math.min(100, sales.month.pct ?? 0)}%` }} /><div className="absolute top-[-3px] h-[18px] w-0.5 bg-navy-900" style={{ right: `${sales.month.pacePct}%` }} title="المتوقع حتى اليوم" /></div>
              <p className={`mt-1 text-xs font-bold ${sales.month.revenue >= sales.month.expectedByNow ? 'text-emerald-700' : 'text-amber-700'}`}>{sales.month.revenue >= sales.month.expectedByNow ? 'متقدم على المعدل ✓' : `متأخر عن المعدل — المتوقع حتى اليوم ${bhd(sales.month.expectedByNow)}. تابع العروض المفتوحة والعملاء السابقين.`}</p>
            </>}
          </div>
          <div className="grid grid-cols-2 gap-2 text-center text-xs">
            <div className="rounded-lg bg-slate-50 p-2"><div className="text-lg font-extrabold text-navy-900">{sales.pipeline.quotes}</div><div className="text-slate-500">عروض مفتوحة</div><div className="ltr font-bold">{bhd(sales.pipeline.value)}</div></div>
            <div className={`rounded-lg p-2 ${sales.pipeline.expiringSoon ? 'bg-amber-50' : 'bg-slate-50'}`}><div className="text-lg font-extrabold text-navy-900">{sales.pipeline.expiringSoon}</div><div className="text-slate-500">تنتهي خلال يومين</div></div>
          </div>
        </div>
      </Card>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="بانتظار متابعتك الآن" value={stats.dueNow} tone={stats.dueNow ? 'red' : 'green'} hint={stats.slowNew ? `${stats.slowNew} جديد ينتظر أكثر من ساعتين` : 'لا تأخير'} />
        <Stat label="مفتوحة" value={stats.open} hint="جديد + تواصل + عرض سعر" />
        <Stat label="طلبات مكتملة (30 يومًا)" value={stats.won} tone="green" hint={stats.revenue ? bhd(stats.revenue) : 'سجّل قيمة الطلب عند الإغلاق'} />
        <Stat label="نسبة التحويل" value={stats.conversion == null ? '—' : `${stats.conversion}%`} hint="مكتمل ÷ (مكتمل + لم يكتمل)" tone="gold" />
        <Stat label="سرعة أول رد (الوسيط)" value={stats.medianHoursToContact == null ? '—' : `${stats.medianHoursToContact} س`} hint="الهدف: أقل من ساعة" />
      </div>
      {today.length > 0 && (
        <Card className="mb-4" title="🎯 ابدأ بهؤلاء اليوم">
          <ol className="space-y-1.5 text-sm">{today.map((t, i) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2">
              <span className="w-5 text-xs font-bold text-slate-400">{i + 1}</span>
              <a href={`#lead-${t.id}`} className="font-bold text-navy-800 underline">{t.name}</a>
              <Badge tone={TIER_TONE[t.tier]}>{TIER_AR[t.tier]} {t.score}</Badge>{t.overdue && <Badge tone="red">متأخر</Badge>}
              <span className="min-w-0 flex-1 truncate text-xs text-slate-600">{t.need}</span>
              {t.reasons.length > 0 && <span className="text-[11px] text-slate-500">{t.reasons.join(' · ')}</span>}
            </li>
          ))}</ol>
          <p className="mt-2 text-[11px] text-slate-500">الترتيب من إشارات حقيقية في الطلب (الاستعجال، الكمية، عرض السعر، العميل السابق، عمر الطلب) + المتابعات المتأخرة — بدون تكلفة.</p>
        </Card>
      )}
      {canEdit && <Card title="+ عميل جديد (اتصال، واتساب، زيارة)" className="mb-4"><LeadForm accounts={accounts} products={products.map((p) => ({ id: p.id, name: p.titleAr }))} /></Card>}
      <nav className="mb-3 flex flex-wrap gap-1.5 text-sm">{tabs.map(([k, ar, c]) => <Link key={k} href={k === 'open' ? '/leads' : `/leads?s=${k}`} className={`rounded-full border px-3 py-1.5 font-bold ${tab === k ? 'border-navy-800 bg-navy-800 text-white' : 'bg-white text-slate-700'}`}>{ar}<span className="mr-1 opacity-70">{c}</span></Link>)}</nav>
      <div className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.map((l) => {
          const due = l.nextFollowUpAt && l.nextFollowUpAt.getTime() <= now && ['NEW', 'CONTACTED', 'QUOTED'].includes(l.status);
          const u = `/api/leads/${l.id}`;
          const open = ['NEW', 'CONTACTED', 'QUOTED'].includes(l.status);
          const prior = priorProfile(profiles.get(customerKey(l.contact) ?? ''), l);
          const sc = open ? scoreLead(l, prior) : null;
          return (
            <article key={l.id} id={`lead-${l.id}`} className={`scroll-mt-20 rounded-2xl border bg-white p-3 shadow-sm ${due ? 'border-red-300' : ''}`}>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <b className="truncate text-navy-900">{l.name ?? l.contact ?? 'عميل'}</b>
                <div className="flex gap-1">{open && <span title={sc!.reasons.join(' · ') || 'لا إشارات قوية بعد'}><Badge tone={TIER_TONE[sc!.tier]}>{TIER_AR[sc!.tier]} {sc!.score}</Badge></span>}<Badge tone={TONE[l.status as LeadStatus]}>{STATUS_AR[l.status as LeadStatus]}</Badge>{due && <Badge tone="red">متابعة اليوم</Badge>}</div>
              </div>
              <p className="text-sm text-slate-800">{l.need}</p>
              {prior && prior.requests > 0 && <p className="mt-1 rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-800">⭐ عميل سابق: {prior.won} طلب{prior.lifetimeBhd > 0 ? ` · ${bhd(prior.lifetimeBhd)}` : ''}{prior.lastWonAt ? ` · آخر طلب ${ago(prior.lastWonAt)}` : ''}{prior.lost > 0 ? ` · لم يكتمل ${prior.lost}` : ''}</p>}
              <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-slate-500">
                <span>{SOURCE_AR[l.source] ?? l.source}</span>{l.account && <span>من {l.account.name}</span>}{l.product && <span>{l.product.titleAr}</span>}<span>{ago(l.createdAt)}</span>
                {l.contact && l.contact !== l.name && <span className="ltr">{l.contact}</span>}
                {l.valueBhd != null && <span className="font-bold text-emerald-700">{bhd(l.valueBhd)}</span>}{l.lostReason && <span>السبب: {l.lostReason}</span>}
              </div>
              {canEdit && ['NEW', 'CONTACTED', 'QUOTED'].includes(l.status) && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {l.status === 'NEW' && <ActionButton url={u} method="PATCH" body={{ status: 'CONTACTED' }} label="تواصلت معه" size="sm" variant="outline" />}
                  {l.status !== 'QUOTED' && <ActionButton url={u} method="PATCH" body={{ status: 'QUOTED' }} label="أرسلت عرض سعر" size="sm" variant="outline" />}
                  <ActionButton url={u} method="PATCH" body={{ status: 'WON' }} label="✓ تم الطلب" size="sm" variant="success" prompt="قيمة الطلب بالدينار (اختياري — لمعرفة العائد لكل حساب)" promptKey="valueBhd" />
                  <ActionButton url={u} method="PATCH" body={{ status: 'LOST' }} label="لم يكتمل" size="sm" variant="ghost" prompt={`السبب؟ (${LOST_REASONS.join(' / ')})`} promptKey="lostReason" />
                  <ActionButton url={u} method="PATCH" body={{ followUpDays: 2 }} label="ذكّرني بعد يومين" size="sm" variant="ghost" />
                </div>
              )}
              {canEdit && (() => {
                const lk = { ...l, quote: l.quote as unknown as Quote | null, touches: l.touches as unknown as Touch[] | null };
                const na = nextAction(lk, ctx);
                if (!na) return null;
                const text = scriptText(na.key, lk, ctx);
                return <SalesAction leadId={l.id} scriptKey={na.key} label={na.label} due={na.due} text={text} wa={waLink(l.contact, text)} />;
              })()}
              {canEdit && l.status !== 'LOST' && <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] font-bold">
                <Link href={`/leads/${l.id}/quote`} className="text-navy-700 underline">{l.quoteNo ? `✎ عرض السعر ${l.quoteNo}` : '🧾 إنشاء عرض سعر'}</Link>
                {l.quoteNo && <Link href={`/q/${l.id}`} className="text-gold-600 underline">عرض / طباعة</Link>}
              </div>}
              {l.commentId && <Link href="/comments" className="mt-1 inline-block text-[11px] font-bold text-gold-600 underline">الرد على التعليق ←</Link>}
            </article>
          );
        })}
        {!list.length && <Card className="md:col-span-2 xl:col-span-3"><p className="text-sm text-slate-500">{tab === 'open' ? 'لا يوجد عملاء بانتظار المتابعة. تعليقات الشراء والسعر تظهر هنا تلقائيًا.' : 'لا شيء هنا بعد.'}</p></Card>}
      </div>
      {sales.reactivate.length > 0 && (
        <Card className="mb-4" title={`🔁 عملاء سابقون جاهزون لطلب جديد (${sales.reactivate.length})`}>
          <p className="mb-3 text-xs text-slate-500">طلبوا منك قبل أكثر من {settings.sales.reactivationDays} يومًا ولم يعودوا. العميل السابق أسهل بيعًا من عميل جديد — رسالة لطيفة تكفي.</p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{sales.reactivate.map((r) => {
            const lk = { name: r.name, contact: r.contact, need: r.need, status: 'WON', createdAt: r.wonAt ?? new Date(), wonAt: r.wonAt, touches: [{ key: 'won_thanks' as const, at: new Date(0).toISOString(), by: '' }] };
            const text = scriptText('reactivate', lk, ctx);
            return (
              <div key={r.id} className="rounded-xl border p-3">
                <div className="flex items-center justify-between gap-2"><b className="truncate">{r.name ?? r.contact ?? 'عميل'}</b>{r.valueBhd != null && <span className="text-xs font-bold text-emerald-700">{bhd(r.valueBhd)}</span>}</div>
                <p className="text-xs text-slate-600">{r.need}</p>
                <div className="text-[11px] text-slate-500">{r.wonAt ? `طلب ${ago(r.wonAt)}` : ''}{r.account ? ` · من ${r.account}` : ''}</div>
                {canEdit && <SalesAction leadId={r.id} scriptKey="reactivate" label="عميل سابق — طلب جديد" due text={text} wa={waLink(r.contact, text)} />}
              </div>
            );
          })}</div>
        </Card>
      )}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="أي حساب يجلب الطلبات؟ (30 يومًا)" className="xl:col-span-2">
          {stats.byAccount.length ? <table className="w-full text-sm"><thead><tr className="text-right text-xs text-slate-500"><th className="py-1">الحساب</th><th>استفسارات</th><th>طلبات</th><th>القيمة</th></tr></thead>
            <tbody>{stats.byAccount.map((a) => <tr key={a.accountId ?? 'x'} className="border-t"><td className="py-1.5 font-bold">{a.name}</td><td>{a.leads}</td><td className="text-emerald-700">{a.won}</td><td className="ltr text-left">{a.revenue ? bhd(a.revenue) : '—'}</td></tr>)}</tbody></table>
            : <p className="text-sm text-slate-500">تظهر هنا بعد أول استفسارات.</p>}
          <p className="mt-2 text-xs text-slate-500">القيم ما تسجله أنت عند إغلاق الطلب — لا تقديرات. اسأل كل عميل «من أي حساب عرفتنا؟».</p>
        </Card>
        <Card title="المصادر وأسباب عدم الاكتمال">
          <div className="space-y-1 text-sm">{stats.bySource.map((s) => <div key={s.source} className="flex justify-between"><span>{SOURCE_AR[s.source] ?? s.source}</span><span>{s.leads} · <b className="text-emerald-700">{s.won}</b></span></div>)}</div>
          {stats.lostReasons.length > 0 && <div className="mt-3 border-t pt-2 text-sm">{stats.lostReasons.map((r) => <div key={r.reason} className="flex justify-between text-slate-600"><span>{r.reason}</span><span>{r.n}</span></div>)}</div>}
          {stats.lostReasons[0]?.reason === 'السعر' && <p className="mt-2 text-xs text-navy-700">💡 أكثر سبب هو السعر — أبرز الجودة والتسليم السريع في التصاميم، واعرض خيارات بكميات مختلفة في عرض السعر.</p>}
        </Card>
      </div>
      {canSettings && <Card className="mt-4" title="⚙️ إعدادات المبيعات" collapsible><SalesSettings initial={settings.sales} /></Card>}
    </>
  );
}
