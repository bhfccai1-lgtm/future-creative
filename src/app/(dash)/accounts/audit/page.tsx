import Link from 'next/link';
import { requirePageUser } from '@/lib/auth/server';
import { Card, PageHeader, Badge } from '@/components/ui';
import { ActionButton } from '@/components/action-button';
import { auditAccounts, type Severity } from '@/lib/ops/account-audit';

export const dynamic = 'force-dynamic';
const SEV: Record<Severity, { ar: string; tone: 'red' | 'amber' | 'blue' | 'slate' }> = { critical: { ar: 'حرج', tone: 'red' }, high: { ar: 'مرتفع', tone: 'amber' }, medium: { ar: 'متوسط', tone: 'blue' }, low: { ar: 'تحسين', tone: 'slate' } };
const GRADE_TONE = { A: 'green', B: 'blue', C: 'amber', D: 'red' } as const;

export default async function AccountAuditPage() {
  await requirePageUser('accounts:manage');
  const audits = await auditAccounts();
  const avgScore = audits.length ? Math.round(audits.reduce((n, a) => n + a.score, 0) / audits.length) : 0;
  const totals = audits.reduce((t, a) => ({ posted: t.posted + a.kpi.posted, reels: t.reels + a.kpi.reels, critical: t.critical + a.issues.filter((i) => i.severity === 'critical').length }), { posted: 0, reels: 0, critical: 0 });
  return (
    <>
      <PageHeader title="🩺 تدقيق حسابات إنستغرام" subtitle="آخر 14 يومًا: ما نُشر فعلًا (مؤكد من المزود)، مزيج الصيغ، الوصول لكل صيغة من مقاييس Metricool، الأخطاء والإعدادات — مع إصلاح لكل مشكلة. الأسوأ أولًا." />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">متوسط صحة الحسابات</div><b className="text-2xl">{avgScore}/100</b></div>
        <div className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">منشورات مؤكدة (14 يومًا)</div><b className="text-2xl">{totals.posted}</b></div>
        <div className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">منها ريلز</div><b className="text-2xl">{totals.reels}</b></div>
        <div className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">مشكلات حرجة</div><b className="text-2xl text-red-700">{totals.critical}</b></div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {audits.map((a) => (
          <Card collapsible key={a.id} title={<span className="flex items-center gap-2"><Badge tone={GRADE_TONE[a.grade]}>{a.grade} · {a.score}</Badge>{a.name}{a.issues.length > 0 && <span className="text-xs font-normal text-slate-500">· {a.issues.length} مشكلة</span>}</span>}>
            <Link className="mb-3 inline-block text-xs font-bold text-navy-700 underline" href={`/accounts/${a.id}`}>فتح إعدادات الحساب{a.handle ? ` (@${a.handle})` : ''}</Link>
            <div className="mb-3 grid grid-cols-3 gap-2 text-xs sm:grid-cols-6">
              <div><div className="text-slate-500">مؤكد</div><b>{a.kpi.posted}{a.kpi.expected ? `/${a.kpi.expected}` : ''}</b></div>
              <div><div className="text-slate-500">ريلز</div><b>{a.kpi.reels}</b></div>
              <div><div className="text-slate-500">كاروسيل/منشور</div><b>{a.kpi.carousels}/{a.kpi.feed}</b></div>
              <div><div className="text-slate-500">ستوري</div><b>{a.kpi.stories}</b></div>
              <div><div className="text-slate-500">وصول الريلز</div><b>{a.kpi.avgReachReel ?? '—'}</b></div>
              <div><div className="text-slate-500">وصول الصور</div><b>{a.kpi.avgReachOther ?? '—'}</b></div>
            </div>
            {a.kpi.daysSinceLast !== null && <p className="mb-2 text-xs text-slate-500">آخر منشور مؤكد قبل {a.kpi.daysSinceLast} يوم · {a.kpi.measured} منشور بمقاييس · {a.kpi.failed} فشل</p>}
            {a.strengths.map((s) => <p key={s} className="text-sm text-emerald-700">✓ {s}</p>)}
            <ul className="mt-2 space-y-2">
              {a.issues.map((i) => (
                <li key={i.id} className="rounded-lg border p-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2"><Badge tone={SEV[i.severity].tone}>{SEV[i.severity].ar}</Badge><b>{i.title}</b></div>
                  <p className="mt-1 text-xs text-slate-600">{i.evidence}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {i.fix.map((f) => f.action
                      ? <ActionButton key={f.label} url={f.action.url} method={f.action.method} body={f.action.body} label={f.label} size="sm" variant="outline" />
                      : <Link key={f.label} href={f.href!} className="rounded-lg border px-3 py-2 text-xs font-bold hover:bg-slate-50 sm:py-1">{f.label}</Link>)}
                  </div>
                </li>
              ))}
              {!a.issues.length && <li className="text-sm text-emerald-700">لا مشكلات — الحساب في حالة ممتازة.</li>}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}
