import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/server';
import { getSettings } from '@/lib/settings';
import { Card, PageHeader, Stat } from '@/components/ui';
import { monthToDateSpend } from '@/lib/ai/cost';
import { startOfMonthInTz } from '@/lib/time';
import { ActionButton } from '@/components/action-button';
import { Badge } from '@/components/ui';
import { loadInsights, type AccountInsight, type Advice } from '@/lib/analytics/account-insights';

const nf = (n: number | null | undefined) => (n == null ? '—' : n >= 10000 ? `${(n / 1000).toFixed(1)}K` : n.toLocaleString('en-US'));
const LEVEL: Record<Advice['level'], { tone: 'red' | 'amber' | 'blue' | 'green'; label: string; ring: string }> = {
  critical: { tone: 'red', label: 'عاجل', ring: 'border-r-red-500' }, high: { tone: 'amber', label: 'مهم', ring: 'border-r-amber-500' },
  medium: { tone: 'blue', label: 'تحسين', ring: 'border-r-sky-500' }, good: { tone: 'green', label: 'ينجح', ring: 'border-r-emerald-500' },
};

function AccountRow({ a, maxF, totalF }: { a: AccountInsight; maxF: number; totalF: number }) {
  const content = a.posts.count + a.reels.count;
  const mult = a.reels.count && a.posts.count && a.posts.avgReach ? a.reels.avgReach / a.posts.avgReach : null;
  return (
    <div className="rounded-xl border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0"><div className="truncate font-extrabold text-navy-900">{a.name}</div>{a.handle && <div className="ltr text-xs text-slate-500">@{a.handle.replace(/^@/, '')}</div>}</div>
        <div className="text-left"><div className="ltr text-lg font-extrabold">{nf(a.followers)}</div><div className="text-[11px] text-slate-500">متابع{a.followers && totalF ? ` · ${Math.round((a.followers / totalF) * 100)}%` : ''}</div></div>
      </div>
      {a.followers != null && <div className="mt-2 h-1.5 rounded bg-slate-100"><div className="h-1.5 rounded bg-gold-500" style={{ width: `${Math.max(2, (a.followers / Math.max(1, maxF)) * 100)}%` }} /></div>}
      {a.error ? <p className="mt-2 text-xs text-red-700">تعذّر جلب البيانات: {a.error}</p> : (
        <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
          <div><div className="font-extrabold text-navy-900">{content}</div><div className="text-slate-500">محتوى</div></div>
          <div><div className="font-extrabold text-navy-900">{a.reels.count ? a.reels.avgReach : '—'}</div><div className="text-slate-500">وصول/ريل</div></div>
          <div><div className="font-extrabold text-navy-900">{a.posts.count ? a.posts.avgReach : '—'}</div><div className="text-slate-500">وصول/صورة</div></div>
          <div><div className={`font-extrabold ${mult && mult >= 2 ? 'text-emerald-700' : 'text-navy-900'}`}>{mult ? `×${mult.toFixed(1)}` : '—'}</div><div className="text-slate-500">ريل÷صورة</div></div>
        </div>
      )}
      {!a.error && <div className="mt-2 flex flex-wrap gap-x-3 text-[11px] text-slate-500"><span>{a.reels.count} ريل · {a.posts.count} صورة</span><span>تفاعل {a.posts.interactions + a.reels.interactions}</span><span>حفظ {a.saves} · مشاركة {a.shares}</span>{a.best[0]?.url && <a className="font-bold text-gold-600 underline" href={a.best[0].url} target="_blank" rel="noreferrer">أفضل منشور ({a.best[0].reach})</a>}</div>}
    </div>
  );
}

function Bars({ rows, unit = '' }: { rows: { label: string; value: number }[]; unit?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[150px_1fr_70px] items-center gap-2 text-xs">
          <span className="truncate">{r.label}</span>
          <div className="h-3 rounded bg-slate-100"><div className="h-3 rounded bg-navy-700" style={{ width: `${(r.value / max) * 100}%` }} /></div>
          <span className="ltr text-left font-bold">{unit}{r.value % 1 ? r.value.toFixed(3) : r.value}</span>
        </div>
      ))}
      {!rows.length && <p className="text-sm text-slate-500">لا توجد بيانات بعد.</p>}
    </div>
  );
}

export default async function AnalyticsPage() {
  await requirePageUser();
  const s = await getSettings();
  const since = new Date(Date.now() - 30 * 86400_000);
  const [byState, byProduct, byAccount, usage, spend, results] = await Promise.all([
    prisma.publicationJob.groupBy({ by: ['state'], _count: true }),
    prisma.advertisement.groupBy({ by: ['productId'], _count: true, where: { createdAt: { gte: since } }, orderBy: { _count: { productId: 'desc' } }, take: 12 }),
    prisma.publicationJob.groupBy({ by: ['accountId'], _count: true, where: { state: 'PUBLISHED' } }),
    prisma.$queryRaw<{ day: string; cost: number }[]>`SELECT to_char(date_trunc('day', "createdAt" AT TIME ZONE 'Asia/Bahrain'), 'MM-DD') AS day, SUM("costUsd")::float AS cost FROM ai_usage WHERE "createdAt" >= ${startOfMonthInTz()} GROUP BY 1 ORDER BY 1`,
    monthToDateSpend(),
    prisma.publicationResult.findMany({ where: { engagementScore: { not: null } }, include: { job: { include: { advertisement: { include: { product: true } } } } }, orderBy: { engagementScore: 'desc' }, take: 10 }),
  ]);
  const products = Object.fromEntries((await prisma.product.findMany({ select: { id: true, titleAr: true, performanceScore: true } })).map((p) => [p.id, p]));
  const accounts = Object.fromEntries((await prisma.socialAccount.findMany({ select: { id: true, name: true } })).map((a) => [a.id, a.name]));
  const count = (st: string) => byState.find((x) => x.state === st)?._count ?? 0;
  return (
    <>
      <PageHeader title="تحليلات الأداء" subtitle="أرقام حقيقية من Metricool لكل حساب (المتابعون، الوصول، الريلز مقابل الصور، أفضل المنشورات) مع توصيات مبنية عليها فقط." />
      <AccountInsightsSection />
      <h2 className="mb-3 mt-8 text-lg font-extrabold text-navy-900">النشر والتكلفة في النظام</h2>
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
        <Stat label="منشور مؤكد" value={count('PUBLISHED')} tone="green" /><Stat label="مجدول" value={count('SCHEDULED')} />
        <Stat label="غير مؤكد" value={count('UNKNOWN')} tone="gold" /><Stat label="فاشل" value={count('FAILED')} tone="red" />
        <Stat label="إنفاق AI هذا الشهر" value={<span className="ltr">${spend.toFixed(2)}</span>} hint={`${((spend / Math.max(0.01, s.ai.monthlyBudgetUsd)) * 100).toFixed(0)}% من الميزانية`} />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="المنتجات الأكثر استخدامًا (30 يومًا)"><Bars rows={byProduct.map((p) => ({ label: products[p.productId]?.titleAr ?? p.productId, value: p._count }))} /></Card>
        <Card title="المنشورات المؤكدة لكل حساب"><Bars rows={byAccount.map((a) => ({ label: accounts[a.accountId] ?? a.accountId, value: a._count }))} /></Card>
        <Card title="تكلفة الذكاء الاصطناعي اليومية (USD)"><Bars rows={usage.map((u) => ({ label: u.day, value: Number(u.cost) }))} unit="$" /></Card>
        <Card title="درجة أداء المنتجات (نسبة للمتوسط)"><Bars rows={Object.values(products).filter((p) => p.performanceScore !== 0).sort((a, b) => b.performanceScore - a.performanceScore).slice(0, 12).map((p) => ({ label: p.titleAr, value: Number(p.performanceScore.toFixed(2)) }))} /></Card>
        <Card title="أفضل المنشورات تفاعلًا" className="xl:col-span-2">
          <table className="w-full"><tbody>{results.map((r) => <tr key={r.id} className="border-t"><td className="td">{r.job.advertisement.headline}</td><td className="td text-xs">{r.job.advertisement.product.titleAr}</td><td className="td font-bold">{r.engagementScore?.toFixed(2)}</td></tr>)}</tbody></table>
          {!results.length && <p className="text-sm text-slate-500">لم تُسجّل مقاييس تفاعل بعد.</p>}
        </Card>
      </div>
    </>
  );
}

async function AccountInsightsSection() {
  const snap = await loadInsights();
  const refresh = <ActionButton url="/api/analytics/accounts" label={snap ? 'تحديث الآن' : 'جلب البيانات الحقيقية الآن'} variant={snap ? 'outline' : 'gold'} size="sm" success="تم التحديث ✓" />;
  if (!snap) return (
    <div className="card mb-6 p-5 text-center"><p className="mb-3 text-sm text-slate-600">لم تُجلب بيانات الحسابات من Metricool بعد. يستغرق الجلب أقل من دقيقة، ويتحدث تلقائيًا كل ليلة.</p>{refresh}</div>
  );
  const t = snap.totals;
  const rows = [...snap.accounts].sort((a, b) => (b.followers ?? -1) - (a.followers ?? -1) || (b.posts.reach + b.reels.reach) - (a.posts.reach + a.reels.reach));
  const maxF = Math.max(0, ...rows.map((a) => a.followers ?? 0));
  const mult = t.postAvg ? t.reelAvg / t.postAvg : null;
  return (
    <section className="mb-2">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">آخر تحديث: <span className="ltr">{new Date(snap.at).toLocaleString('en-GB', { timeZone: 'Asia/Bahrain', dateStyle: 'medium', timeStyle: 'short' })}</span> · آخر {snap.days} يومًا · {snap.accounts.length} حساب</p>
        {refresh}
      </div>
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="إجمالي المتابعين" value={<span className="ltr">{nf(t.followers || null)}</span>} tone="gold" />
        <Stat label="الوصول (30 يومًا)" value={<span className="ltr">{nf(t.reach)}</span>} hint={`${t.content} منشور/ريل`} />
        <Stat label="متوسط وصول الريل" value={t.reelAvg} hint={mult ? `×${mult.toFixed(1)} من الصورة (${t.postAvg})` : `الصورة: ${t.postAvg}`} tone="green" />
        <Stat label="التفاعلات" value={<span className="ltr">{nf(t.interactions)}</span>} hint="إعجاب + تعليق + حفظ + مشاركة" />
      </div>
      {snap.advice.length > 0 && (
        <Card title="توصيات مبنية على أرقامك" className="mb-5">
          <div className="space-y-3">{snap.advice.map((a, i) => (
            <div key={i} className={`rounded-lg border border-r-4 bg-white p-3 ${LEVEL[a.level].ring}`}>
              <div className="mb-1 flex items-center gap-2"><Badge tone={LEVEL[a.level].tone}>{LEVEL[a.level].label}</Badge><b className="text-sm text-navy-900">{a.title}</b></div>
              <p className="text-sm leading-7 text-slate-700">{a.detail}</p>
            </div>
          ))}</div>
          <p className="mt-3 text-xs text-slate-500">التوصيات قواعد ثابتة على الأرقام أعلاه — لا شيء مُخمَّن. الأرقام الصغيرة (حسابات جديدة) مؤشرات أولية.</p>
        </Card>
      )}
      <Card title="الحسابات — مرتبة حسب الجمهور">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{rows.map((a) => <AccountRow key={a.accountId} a={a} maxF={maxF} totalF={t.followers} />)}</div>
        <p className="mt-3 text-xs text-slate-500">المصدر: Metricool (قراءة فقط). إحصاءات الستوري لا تصل عبر الربط فلا تظهر هنا. «—» = غير متاح من المصدر.</p>
      </Card>
    </section>
  );
}
