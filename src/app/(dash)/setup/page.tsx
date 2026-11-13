import Link from 'next/link';
import { requirePageUser } from '@/lib/auth/server';
import { PageHeader, Badge } from '@/components/ui';
import { GROUP_AR, setupChecklist, type Group } from '@/lib/ops/setup-checklist';

export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  await requirePageUser();
  const { items, done, total, next } = await setupChecklist();
  const pct = Math.round((done / total) * 100);
  const R = 52, C = 2 * Math.PI * R;
  return (
    <>
      <PageHeader title="🚀 مركز التفعيل" subtitle="كل قدرات النظام في صفحة واحدة: حالتها الحقيقية الآن، ولماذا تهمّ، وزر لإكمالها. ابدأ من الأعلى — الترتيب حسب سرعة النتيجة." />
      <div className="mb-6 flex flex-col items-center gap-4 rounded-2xl border bg-white p-5 sm:flex-row">
        <svg width="130" height="130" viewBox="0 0 130 130" className="shrink-0" aria-label={`${pct}%`}>
          <circle cx="65" cy="65" r={R} fill="none" stroke="#e2e8f0" strokeWidth="12" />
          <circle cx="65" cy="65" r={R} fill="none" stroke={pct === 100 ? '#059669' : '#d4af37'} strokeWidth="12" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - done / total)} transform="rotate(-90 65 65)" />
          <text x="65" y="62" textAnchor="middle" className="fill-navy-900" style={{ fontSize: 26, fontWeight: 800 }}>{pct}%</text>
          <text x="65" y="84" textAnchor="middle" className="fill-slate-500" style={{ fontSize: 12 }}>{done} من {total}</text>
        </svg>
        <div className="flex-1 text-center sm:text-right">
          {next ? (
            <>
              <div className="text-xs font-bold text-slate-500">الخطوة التالية</div>
              <div className="mt-1 text-lg font-extrabold text-navy-900">{next.title}</div>
              <p className="mt-1 text-sm text-slate-600">{next.why}</p>
              <Link href={next.href} className="mt-3 inline-block rounded-xl bg-gold-500 px-5 py-3 text-sm font-extrabold text-navy-950">{next.cta} ←</Link>
            </>
          ) : <div className="text-lg font-extrabold text-emerald-700">🎉 كل شيء مفعّل — النظام يعمل بكامل قدراته</div>}
        </div>
      </div>
      {(Object.keys(GROUP_AR) as Group[]).map((g) => (
        <section key={g} className="mb-6">
          <h2 className="mb-2 text-sm font-extrabold text-navy-800">{GROUP_AR[g]}</h2>
          <div className="space-y-2">
            {items.filter((i) => i.group === g).sort((a, b) => Number(a.done) - Number(b.done)).map((i) => (
              <div key={i.id} className={`flex items-start gap-3 rounded-xl border p-3 ${i.done ? 'bg-emerald-50/60' : 'bg-white'}`}>
                <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ${i.done ? 'bg-emerald-600 text-white' : 'border-2 border-slate-300 text-slate-400'}`}>{i.done ? '✓' : ''}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><b className={i.done ? 'text-emerald-900' : 'text-navy-900'}>{i.title}</b>{i.optional && <Badge>اختياري</Badge>}</div>
                  <p className="text-xs text-slate-600">{i.why}{i.detail ? <span className="text-slate-500"> · {i.detail}</span> : null}</p>
                </div>
                {!i.done && <Link href={i.href} className="shrink-0 rounded-lg border px-3 py-2 text-xs font-bold text-navy-800 hover:bg-slate-50">{i.cta}</Link>}
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
