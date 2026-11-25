import Link from 'next/link';
import { requirePageUser } from '@/lib/auth/server';
import { Card, PageHeader, Badge, Stat } from '@/components/ui';
import { runDiagnostics } from '@/lib/ops/diagnostics';
import { runAdvisor, healthHistory, CATEGORY_AR, SEVERITY_AR, type Advice, type Category, type Severity } from '@/lib/ops/advisor';
import { fmtLocal } from '@/lib/time';
import { runAnalysis, supportReport, type Verdict } from '@/lib/ops/analysis';
import { CopyReportButton } from '@/components/copy-report-button';
export const dynamic = 'force-dynamic';

const TONE = { OK: 'green', WARN: 'amber', FAIL: 'red' } as const;
const AR = { OK: 'سليم', WARN: 'تنبيه', FAIL: 'خلل' } as const;
const SEV_TONE: Record<Severity, 'red' | 'amber' | 'blue' | 'slate'> = { critical: 'red', high: 'red', medium: 'amber', low: 'blue', info: 'slate' };
const SEV_ICON: Record<Severity, string> = { critical: '🚨', high: '🔴', medium: '🟡', low: '🔵', info: 'ℹ️' };
const GRADE_COLOR = { A: '#059669', B: '#65a30d', C: '#d97706', D: '#dc2626', F: '#991b1b' } as const;
const val = (v: number | null, unit = '') => (v === null ? '—' : `${v}${unit}`);
const VERDICT: Record<Verdict, { t: string; tone: 'green' | 'red' | 'slate' | 'blue' }> = {
  improved: { t: '↑ تحسّن حقيقي', tone: 'green' }, worsened: { t: '↓ تراجع حقيقي', tone: 'red' }, stable: { t: '= ضمن التذبذب', tone: 'slate' }, insufficient: { t: 'عينة غير كافية', tone: 'blue' },
};
const SEV_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

function Gauge({ score, grade }: { score: number; grade: keyof typeof GRADE_COLOR }) {
  const r = 52, c = 2 * Math.PI * r, color = GRADE_COLOR[grade];
  return (
    <svg viewBox="0 0 120 120" className="h-32 w-32 shrink-0" role="img" aria-label={`درجة صحة النظام ${score} من 100`}>
      <circle cx="60" cy="60" r={r} fill="none" stroke="#e2e8f0" strokeWidth="10" />
      <circle cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 60 60)" />
      <text x="60" y="58" textAnchor="middle" fontSize="30" fontWeight="800" fill={color}>{score}</text>
      <text x="60" y="80" textAnchor="middle" fontSize="13" fill="#64748b">التقدير {grade}</text>
    </svg>
  );
}

function Trend({ points }: { points: { date: string; score: number }[] }) {
  if (points.length < 2) return <p className="text-xs text-slate-500">يظهر الاتجاه بعد يومين من التشغيل (لقطة يومية 06:50).</p>;
  const w = 260, h = 60, xs = (i: number) => (i / (points.length - 1)) * w, ys = (s: number) => h - (s / 100) * h;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)},${ys(p.score).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h + 14}`} className="w-full max-w-xs" role="img" aria-label="اتجاه درجة الصحة">
      <path d={d} fill="none" stroke="#0b1730" strokeWidth="2" />
      {points.map((p, i) => <circle key={p.date} cx={xs(i)} cy={ys(p.score)} r="2.5" fill="#d4af37"><title>{`${p.date}: ${p.score}`}</title></circle>)}
      <text x="0" y={h + 12} fontSize="9" fill="#64748b">{points[0].date}</text>
      <text x={w} y={h + 12} fontSize="9" fill="#64748b" textAnchor="end">{points[points.length - 1].date}</text>
    </svg>
  );
}

function AdviceCard({ a }: { a: Advice }) {
  return (
    <details className="rounded-xl border bg-white p-3 open:shadow-sm" open={a.severity === 'critical' || a.severity === 'high'}>
      <summary className="flex cursor-pointer list-none items-start gap-2">
        <span aria-hidden>{SEV_ICON[a.severity]}</span>
        <span className="flex-1 font-bold text-navy-900">{a.title}</span>
        <Badge tone={SEV_TONE[a.severity]}>{SEVERITY_AR[a.severity]}</Badge>
      </summary>
      <div className="mt-2 space-y-2 pr-6 text-sm">
        <p><span className="font-bold text-slate-600">الدليل: </span>{a.evidence}</p>
        <p><span className="font-bold text-slate-600">لماذا يهم: </span>{a.why}</p>
        <div><span className="font-bold text-slate-600">خطوات الإصلاح:</span>
          <ol className="mt-1 list-decimal space-y-0.5 pr-5">{a.steps.map((s, i) => <li key={i}>{/^(docker|df|free|ls)\b/.test(s) ? <code dir="ltr" className="rounded bg-slate-100 px-1 text-xs">{s}</code> : s}</li>)}</ol>
        </div>
        {a.link && <Link href={a.link} className="inline-block rounded-lg bg-navy-800 px-3 py-1 text-xs font-bold text-white hover:bg-navy-700">الانتقال للإصلاح ←</Link>}
      </div>
    </details>
  );
}

export default async function DiagnosticsPage() {
  await requirePageUser();
  const [d, adv, hist, an] = await Promise.all([runDiagnostics(), runAdvisor(), healthHistory(), runAnalysis()]);
  const k = adv.kpis;
  // the analysis adds its own findings (trends, service levels, runtime, migrations) to the advisor's, by priority
  const allAdvice = [...an.advice, ...adv.advice].sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
  const report = supportReport(an, { version: process.env.APP_VERSION ?? 'dev', overall: d.overall, score: adv.score, failedChecks: d.checks.filter((c) => c.status !== 'OK').map((c) => `${c.label}: ${c.detail}`) });
  const byCat = new Map<Category, Advice[]>();
  for (const a of allAdvice) byCat.set(a.category, [...(byCat.get(a.category) ?? []), a]);
  return (
    <>
      <PageHeader title="تشخيص النظام والمستشار الاحترافي" subtitle={`فحص مباشر وتوصيات مبنية على بياناتك الفعلية — ${fmtLocal(new Date(d.at))} (البحرين). لا تُعرض قيم المفاتيح السرية، ولا تُقدَّر أرقام غير موجودة.`}
        actions={<Badge tone={TONE[d.overall]}>الفحص الفني: {AR[d.overall]}</Badge>} />

      <div className="mb-6 grid gap-6 xl:grid-cols-[auto_1fr]">
        <Card>
          <div className="flex items-center gap-4">
            <Gauge score={adv.score} grade={adv.grade} />
            <div className="space-y-1 text-sm">
              <div className="font-extrabold text-navy-900">درجة صحة النظام</div>
              {(['critical', 'high', 'medium', 'low'] as Severity[]).map((s) => <div key={s} className="flex items-center gap-2"><span aria-hidden>{SEV_ICON[s]}</span><span className="w-16">{SEVERITY_AR[s]}</span><b>{adv.counts[s]}</b></div>)}
            </div>
          </div>
          <div className="mt-3 border-t pt-2"><div className="mb-1 text-xs font-bold text-slate-500">الاتجاه اليومي</div><Trend points={hist} /></div>
        </Card>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="تصاميم (7 أيام)" value={k.designs7d} />
          <Stat label="نجاح فحص الجودة" value={val(k.qcPassRate, '%')} tone={k.qcPassRate !== null && k.qcPassRate < 70 ? 'red' : 'green'} />
          <Stat label="نسبة الاعتماد" value={val(k.approvalRate, '%')} />
          <Stat label="نجاح النشر (14 يومًا)" value={val(k.publishSuccessRate, '%')} tone={k.publishSuccessRate !== null && k.publishSuccessRate < 80 ? 'red' : 'green'} />
          <Stat label="منشور مؤكد (7 أيام)" value={k.verifiedPublished7d} tone="green" />
          <Stat label="بانتظار الموافقة" value={k.pendingApprovals} tone={k.pendingApprovals >= 10 ? 'gold' : 'navy'} />
          <Stat label="متوسط التفاعل (30 يومًا)" value={val(k.avgEngagement30d, '%')} />
          <Stat label="تكلفة التصميم" value={k.costPerDesign === null ? '—' : <span className="ltr">${k.costPerDesign}</span>} />
          <Stat label="تكلفة المنشور المؤكد" value={k.costPerVerifiedPost === null ? '—' : <span className="ltr">${k.costPerVerifiedPost}</span>} />
          <Stat label="إنفاق الشهر / المتوقع" value={<span className="ltr">${k.monthSpend} / ${k.projectedMonthSpend}</span>} hint={`الميزانية $${k.monthBudget}`} tone={k.projectedMonthSpend > k.monthBudget ? 'red' : 'navy'} />
        </div>
      </div>

      <Card collapsible title={`توصيات المحترف (${allAdvice.length}) — مرتبة حسب الأولوية`} className="mb-6">
        {!allAdvice.length ? <p className="text-sm text-emerald-700">لا توجد توصيات — النظام في حالة ممتازة ✅</p> : (
          <div className="grid gap-5 lg:grid-cols-2">
            {[...byCat.entries()].map(([cat, list]) => (
              <section key={cat}>
                <h3 className="mb-2 text-sm font-extrabold text-navy-800">{CATEGORY_AR[cat]} <span className="font-normal text-slate-500">({list.length})</span></h3>
                <div className="space-y-2">{list.map((a) => <AdviceCard key={a.id} a={a} />)}</div>
              </section>
            ))}
          </div>
        )}
      </Card>

      <Card collapsible title="التحليل المتقدم — هذا الأسبوع مقابل السابق" className="mb-6" actions={<CopyReportButton text={report} />}>
        <p className="mb-3 text-xs text-slate-500">«تحسّن/تراجع حقيقي» فقط عندما تثبته اختبارات الدلالة الإحصائية بثقة 95٪ (z ≥ 1.96)؛ الفروق الصغيرة تُعدّ تذبذبًا طبيعيًا، والعينات الصغيرة لا يُحكم عليها.</p>
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm"><thead><tr><th className="th">المؤشر</th><th className="th">الأسبوع السابق</th><th className="th">هذا الأسبوع</th><th className="th">العينة</th><th className="th">الحكم</th></tr></thead>
          <tbody>{an.trends.map((t) => { const u = t.unit === '%' ? '%' : t.unit === '$' ? ' $' : ''; return <tr key={t.id} className="border-t"><td className="td font-bold">{t.label}</td><td className="td">{val(t.previous, u)}</td><td className="td font-bold">{val(t.current, u)}</td><td className="td text-xs text-slate-500">{t.n[0]} / {t.n[1]}{t.z !== null && <span className="ltr"> · z={t.z.toFixed(2)}</span>}</td><td className="td"><Badge tone={VERDICT[t.verdict].tone}>{VERDICT[t.verdict].t}</Badge></td></tr>; })}</tbody>
        </table></div>

        <h3 className="mb-2 mt-5 text-sm font-extrabold text-navy-800">مستويات الخدمة (SLO) — آخر 7 أيام</h3>
        <div className="grid gap-3 md:grid-cols-3">
          {an.slos.map((s) => (
            <div key={s.id} className={`rounded-xl border p-3 text-sm ${s.ok === false ? 'border-red-300 bg-red-50' : s.ok ? 'border-emerald-200 bg-emerald-50/50' : ''}`}>
              <div className="font-bold">{s.label}</div>
              <div className="mt-1">الوسيط <b>{val(s.p50)}</b> · 90٪ خلال <b>{val(s.p90)}</b> {s.unit}</div>
              <div className="mt-1 text-xs text-slate-500">الهدف: {s.targetOn === 'p50' ? 'الوسيط' : '90٪'} ≤ {s.target} {s.unit} · عينة {s.n} · {s.ok === null ? 'غير كافية للحكم' : s.ok ? 'محقق ✓' : 'غير محقق ✗'}</div>
            </div>
          ))}
        </div>

        <h3 className="mb-2 mt-5 text-sm font-extrabold text-navy-800">الأسباب الجذرية للأعطال (باريتو، 7 أيام) — {an.causesTotal} حالة</h3>
        {!an.causes.length ? <p className="text-sm text-emerald-700">لا أعطال مسجلة هذا الأسبوع ✅</p> : (
          <div className="space-y-1.5">{an.causes.map((c) => (
            <div key={c.source + c.key} className="text-sm">
              <div className="flex justify-between gap-3"><span><span className="text-xs text-slate-500">[{c.source}]</span> {c.key}</span><span className="shrink-0 font-bold">{c.count} · {c.share}%</span></div>
              <div className="h-2 rounded bg-slate-100"><div className="h-2 rounded bg-gold-500" style={{ width: `${c.share}%` }} /></div>
            </div>
          ))}<p className="pt-1 text-xs text-slate-500">ابدأ من الأعلى: أول {an.causes.findIndex((c) => c.cumulative >= 80) + 1 || an.causes.length} أسباب تمثل ~80٪ من الأعطال.</p></div>
        )}

        <h3 className="mb-2 mt-5 text-sm font-extrabold text-navy-800">التشغيل</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="الذاكرة" value={val(an.runtime.memory.usedPct, '%')} hint={an.runtime.memory.limitMb ? `من ${an.runtime.memory.limitMb} MB · التطبيق ${an.runtime.memory.rssMb} MB` : undefined} tone={an.runtime.memory.usedPct !== null && an.runtime.memory.usedPct > 90 ? 'red' : 'navy'} />
          <Stat label="حمل المعالج / نواة" value={an.runtime.load1PerCpu} tone={an.runtime.load1PerCpu > 1.5 ? 'red' : 'navy'} hint={`يعمل منذ ${an.runtime.uptimeH} ساعة`} />
          <Stat label="الطوابير (انتظار · فاشل)" value={an.runtime.queues ? `${an.runtime.queues.reduce((a, q) => a + q.waiting, 0)} · ${an.runtime.queues.reduce((a, q) => a + q.failed, 0)}` : '—'} hint={an.runtime.queues ? an.runtime.queues.map((q) => `${q.name.replace('fc-', '')} ${q.active} نشطة`).join(' · ') : 'Redis غير متاح'} />
          <Stat label="تحديثات قاعدة البيانات" value={an.runtime.migrations ? (an.runtime.migrations.pending.length + an.runtime.migrations.failed.length ? `${an.runtime.migrations.pending.length + an.runtime.migrations.failed.length} غير مطبّق` : 'مكتملة ✓') : '—'} hint={an.runtime.migrations ? `${an.runtime.migrations.applied} مطبّق` : 'تعذّرت القراءة'} tone={an.runtime.migrations && an.runtime.migrations.pending.length + an.runtime.migrations.failed.length ? 'red' : 'green'} />
        </div>
      </Card>

      <Card collapsible title="الفحوصات الفنية المباشرة" className="overflow-x-auto">
        <table className="w-full min-w-[720px]"><thead><tr><th className="th">الفحص</th><th className="th">الحالة</th><th className="th">التفاصيل</th><th className="th">الإجراء المطلوب</th></tr></thead>
          <tbody>{d.checks.map((c) => <tr key={c.id} className="border-t"><td className="td font-bold">{c.label}</td><td className="td"><Badge tone={TONE[c.status]}>{AR[c.status]}</Badge></td><td className="td text-xs">{c.detail}</td><td className="td text-xs text-navy-700">{c.action ?? '—'}{c.command && <code dir="ltr" className="mt-1 block rounded bg-slate-100 px-2 py-1 text-left text-[11px]">{c.command}</code>}</td></tr>)}</tbody>
        </table>
      </Card>
    </>
  );
}
