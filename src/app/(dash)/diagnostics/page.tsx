import Link from 'next/link';
import { requirePageUser } from '@/lib/auth/server';
import { Card, PageHeader, Badge, Stat } from '@/components/ui';
import { runDiagnostics } from '@/lib/ops/diagnostics';
import { runAdvisor, healthHistory, CATEGORY_AR, SEVERITY_AR, type Advice, type Category, type Severity } from '@/lib/ops/advisor';
import { fmtLocal } from '@/lib/time';
export const dynamic = 'force-dynamic';

const TONE = { OK: 'green', WARN: 'amber', FAIL: 'red' } as const;
const AR = { OK: 'سليم', WARN: 'تنبيه', FAIL: 'خلل' } as const;
const SEV_TONE: Record<Severity, 'red' | 'amber' | 'blue' | 'slate'> = { critical: 'red', high: 'red', medium: 'amber', low: 'blue', info: 'slate' };
const SEV_ICON: Record<Severity, string> = { critical: '🚨', high: '🔴', medium: '🟡', low: '🔵', info: 'ℹ️' };
const GRADE_COLOR = { A: '#059669', B: '#65a30d', C: '#d97706', D: '#dc2626', F: '#991b1b' } as const;
const val = (v: number | null, unit = '') => (v === null ? '—' : `${v}${unit}`);

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
  const [d, adv, hist] = await Promise.all([runDiagnostics(), runAdvisor(), healthHistory()]);
  const k = adv.kpis;
  const byCat = new Map<Category, Advice[]>();
  for (const a of adv.advice) byCat.set(a.category, [...(byCat.get(a.category) ?? []), a]);
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

      <Card title={`توصيات المحترف (${adv.advice.length}) — مرتبة حسب الأولوية`} className="mb-6">
        {!adv.advice.length ? <p className="text-sm text-emerald-700">لا توجد توصيات — النظام في حالة ممتازة ✅</p> : (
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

      <Card title="الفحوصات الفنية المباشرة" className="overflow-x-auto">
        <table className="w-full min-w-[720px]"><thead><tr><th className="th">الفحص</th><th className="th">الحالة</th><th className="th">التفاصيل</th><th className="th">الإجراء المطلوب</th></tr></thead>
          <tbody>{d.checks.map((c) => <tr key={c.id} className="border-t"><td className="td font-bold">{c.label}</td><td className="td"><Badge tone={TONE[c.status]}>{AR[c.status]}</Badge></td><td className="td text-xs">{c.detail}</td><td className="td text-xs text-navy-700">{c.action ?? '—'}{c.command && <code dir="ltr" className="mt-1 block rounded bg-slate-100 px-2 py-1 text-left text-[11px]">{c.command}</code>}</td></tr>)}</tbody>
        </table>
      </Card>
    </>
  );
}
