import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/server';
import { Card, PageHeader, Stat, Badge } from '@/components/ui';
import { buildReport } from '@/lib/analytics/report';
import { labelOf } from '@/lib/analytics/insights';
import { ActionButton } from '@/components/action-button';
import { fmtLocal } from '@/lib/time';

const CONF: Record<string, { t: string; tone: 'green' | 'amber' | 'slate' }> = { CONFIRMED: { t: 'مؤكد إحصائيًا', tone: 'green' }, TREND: { t: 'اتجاه غير مؤكد', tone: 'amber' }, INSUFFICIENT: { t: 'بيانات غير كافية', tone: 'slate' } };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ period?: string; account?: string }> }) {
  await requirePageUser();
  const sp = await searchParams;
  const period = sp.period === 'month' ? 'month' : 'week';
  const [accounts, r] = await Promise.all([prisma.socialAccount.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }), buildReport(period, sp.account || undefined)]);
  const m = r.metrics;
  return (
    <>
      <PageHeader title="التقارير والتجارب" subtitle="أرقام من منشورات مؤكدة النشر ومقاييس Metricool المستوردة أو المُدخلة يدويًا فقط — لا تقديرات ولا وعود مشاهدات."
        actions={<ActionButton url="/api/analytics/import" label="استيراد مقاييس Metricool الآن" variant="outline" />} />
      <form className="mb-4 flex flex-wrap gap-2">
        <select name="period" defaultValue={period} className="input" style={{ width: '11rem' }}><option value="week">أسبوعي</option><option value="month">شهري (30 يومًا)</option></select>
        <select name="account" defaultValue={sp.account ?? ''} className="input" style={{ width: '16rem' }}><option value="">كل الحسابات</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <button className="rounded-lg bg-navy-800 px-4 text-sm font-bold text-white">عرض</button>
        <a className="rounded-lg border px-4 py-2 text-sm" href={`/api/reports?period=${period}${sp.account ? `&account=${sp.account}` : ''}`}>تنزيل JSON</a>
      </form>
      <p className="mb-4 text-xs text-slate-500">الفترة: {fmtLocal(new Date(r.from))} ← {fmtLocal(new Date(r.to))} (توقيت البحرين){r.accountName ? ` · ${r.accountName}` : ''}</p>
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-6">
        <Stat label="منشور مؤكد" value={m.posts} tone="green" /><Stat label="بمقاييس" value={m.withMetrics} />
        <Stat label="الوصول" value={m.reach.toLocaleString('en')} /><Stat label="المشاهدات" value={m.views.toLocaleString('en')} />
        <Stat label="الحفظ + المشاركة" value={(m.saves + m.shares).toLocaleString('en')} /><Stat label="متوسط التفاعل" value={m.avgEngagement === null ? '—' : `${m.avgEngagement}%`} tone="gold" />
      </div>
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-6">
        <Stat label="تخطي الريلز (أول 3 ث)" value={m.reelSkipRatePct === null ? '—' : `${m.reelSkipRatePct}%`} tone={m.reelSkipRatePct !== null && m.reelSkipRatePct > 60 ? 'red' : 'navy'} hint="أقل = افتتاحية أقوى" />
        <Stat label="الاحتفاظ بالمشاهدة" value={m.reelRetentionPct === null ? '—' : `${m.reelRetentionPct}%`} hint="نسبة المدة المشاهدة" />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="التوصيات">
          <ul className="list-disc space-y-1 pr-5 text-sm">{r.recommendations.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </Card>
        <Card title="حالة النشر في الفترة">
          <div className="flex flex-wrap gap-2 text-sm">{Object.entries(r.publishing).map(([k, v]) => <Badge key={k} tone={k === 'PUBLISHED' ? 'green' : k === 'FAILED' ? 'red' : k === 'UNKNOWN' ? 'amber' : 'slate'}>{k}: {v}</Badge>)}{!Object.keys(r.publishing).length && <span className="text-slate-500">لا توجد مهام نشر.</span>}</div>
        </Card>
        <Card title={`الأنماط وتجارب A/B (آخر 90 يومًا — ${r.analysis.total} منشور بمقاييس)`} className="xl:col-span-2">
          {!r.analysis.insights.length ? <p className="text-sm text-slate-500">لا توجد بيانات كافية للمقارنة بعد. تحتاج منشورات مؤكدة بمقاييس تفاعل في مجموعتين على الأقل.</p> : (
            <table className="w-full text-sm"><thead><tr><th className="th">البُعد</th><th className="th">الأفضل</th><th className="th">الفرق</th><th className="th">العينة</th><th className="th">الثقة</th><th className="th">تجربة مقترحة</th></tr></thead>
              <tbody>{r.analysis.insights.map((i) => (
                <tr key={i.dimension} className="border-t">
                  <td className="td">{i.dimensionAr}</td><td className="td font-bold">{labelOf(i.dimension, i.best.value)}</td>
                  <td className="td ltr">{i.liftPct >= 0 ? '+' : ''}{i.liftPct.toFixed(0)}%{i.p !== null && <span className="text-xs text-slate-500"> (p={i.p.toFixed(3)})</span>}</td>
                  <td className="td text-xs">{i.best.n} مقابل {i.rest.n}</td>
                  <td className="td"><Badge tone={CONF[i.confidence].tone}>{CONF[i.confidence].t}</Badge></td>
                  <td className="td text-xs">{i.experiment ? <>A: {labelOf(i.dimension, i.experiment.a)} ↔ B: {labelOf(i.dimension, i.experiment.b)}{i.experiment.perVariant ? ` · ~${i.experiment.perVariant} منشور لكل نسخة` : ''}</> : '—'}</td>
                </tr>))}</tbody></table>)}
        </Card>
        <Card title="الأعلى تفاعلًا"><ul className="space-y-1 text-sm">{r.top.map((t, i) => <li key={i}>{t.score}% · {t.headline} <span className="text-xs text-slate-500">({t.account} · {t.at})</span>{t.url && <> · <a className="underline" href={t.url} target="_blank" rel="noreferrer">فتح</a></>}</li>)}{!r.top.length && <li className="text-slate-500">—</li>}</ul></Card>
        <Card title="الأضعف تفاعلًا"><ul className="space-y-1 text-sm">{r.bottom.map((t, i) => <li key={i}>{t.score}% · {t.headline} <span className="text-xs text-slate-500">({t.account} · {t.at})</span></li>)}{!r.bottom.length && <li className="text-slate-500">—</li>}</ul></Card>
        <Card title="الإخفاقات" className="xl:col-span-2"><ul className="space-y-1 text-sm">{r.failures.map((f, i) => <li key={i}><b>{f.account}</b> · {f.at} · <span className="text-red-700">{f.error.slice(0, 160)}</span></li>)}{!r.failures.length && <li className="text-slate-500">لا توجد إخفاقات في الفترة.</li>}</ul></Card>
      </div>
    </>
  );
}
