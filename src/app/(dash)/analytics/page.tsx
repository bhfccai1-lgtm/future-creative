import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/server';
import { getSettings } from '@/lib/settings';
import { Card, PageHeader, Stat } from '@/components/ui';
import { monthToDateSpend } from '@/lib/ai/cost';
import { startOfMonthInTz } from '@/lib/time';

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
      <PageHeader title="تحليلات الأداء" subtitle="مبنية على نتائج نشر مؤكدة فقط. مقاييس التفاعل تُدخل يدويًا أو من تكامل تحليلات (غير مفعّل افتراضيًا)." />
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
