'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiCall } from '@/lib/client/api';
import type { AccountPlan } from '@/lib/growth/account-plan';
import { Badge, Button } from './ui';
import { toast } from './toaster';

const FORMAT_AR: Record<string, string> = { REEL_VIDEO: 'ريل', IMAGE_CAROUSEL: 'كاروسيل', IMAGE_FEED: 'منشور', IMAGE_SQUARE: 'مربع', IMAGE_STORY: 'ستوري' };
const LEVEL: Record<string, { tone: 'red' | 'amber' | 'slate'; ar: string }> = { high: { tone: 'red', ar: 'عاجل' }, medium: { tone: 'amber', ar: 'مهم' }, info: { tone: 'slate', ar: 'ملاحظة' } };
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v)}٪`);

function Copy({ text, label = 'نسخ' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="rounded-md border border-slate-300 px-2 py-0.5 text-[11px] font-bold"
      onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { toast('انسخ النص يدويًا', 'error'); } }}>
      {done ? 'نُسخ ✓' : label}
    </button>
  );
}

function PlanCard({ p, canCreate }: { p: AccountPlan; canCreate: boolean }) {
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>(p.ideas.filter((i) => !i.inBank).map((i) => i.key));
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (k: string, fn: () => Promise<{ message?: string }>, ok: string) => {
    setBusy(k);
    try { const r = await fn(); toast(r.message ?? ok); router.refresh(); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(null); }
  };
  const t = p.totals;
  return (
    <div className="space-y-4 pt-2">
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        {[['المنشورات المقاسة', `${p.measured} من ${p.posts}`], ['المشاهدات', t.views.toLocaleString('en-US')], ['حفظ · مشاركة · تعليق', `${t.saves} · ${t.shares} · ${t.comments}`], ['الإكمال · التخطي', `${pct(t.retention)} · ${pct(t.skip)}`]].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-slate-50 p-2"><div className="text-[11px] text-slate-500">{k}</div><div className="font-bold tabular-nums">{v}</div></div>
        ))}
      </div>

      {p.top && (
        <div className="rounded-xl border border-gold-500/50 bg-gold-300/10 p-3 text-sm">
          <div className="text-[11px] font-bold text-slate-500">أفضل منشور · {FORMAT_AR[p.top.format] ?? p.top.format} · {p.top.product}</div>
          <p className="my-1 font-bold">«{p.top.hook || p.top.headline}»</p>
          <p className="text-xs text-slate-600">{p.top.views} مشاهدة · وصول {p.top.reach} · إكمال {pct(p.top.retention)} · تخطٍّ {pct(p.top.skip)} — <b>{p.top.reason}</b></p>
          <a href={`/ads/${p.top.adId}`} className="text-xs font-bold text-navy-700 underline">فتح التصميم</a>
        </div>
      )}

      {(p.hooks.question.n > 0 || p.hooks.statement.n > 0) && (
        <div className="rounded-xl bg-slate-50 p-3 text-xs">
          <b>الافتتاحية مقابل التخطي في أول ٣ ثوانٍ:</b> بسؤال ({p.hooks.question.n}): {pct(p.hooks.question.skip)} · بجملة أو منتج ({p.hooks.statement.n}): {pct(p.hooks.statement.skip)}
          {p.frequency && <span className="block mt-1"><b>النشر مقابل المشاهدات:</b> النصف الأول {p.frequency.first.posts} منشور بمتوسط {p.frequency.first.avgViews ?? '—'} · النصف الثاني {p.frequency.second.posts} بمتوسط {p.frequency.second.avgViews ?? '—'}</span>}
          <span className="block mt-1 text-slate-500">الأرقام من Metricool؛ القراءة تفسير محتمل وليست سببًا مثبتًا.</span>
        </div>
      )}

      {p.brain && p.brain.rules.length > 0 && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm">
          <div className="mb-1 font-extrabold">🧠 ما تعلّمه النظام من أرقام هذا الحساب</div>
          <ul className="space-y-1">{p.brain.rules.map((r, k) => <li key={k}>• {r.ar}{Math.min(r.nBest, r.nWorst) < 5 && <span className="text-xs text-amber-700"> (عينة صغيرة — مبدئي)</span>}</li>)}</ul>
          <p className="mt-1 text-[11px] text-slate-600">تُطبَّق تلقائيًا على تصاميم هذا الحساب الجديدة، وتصميم من كل ٥ يجرّب بدونها حتى يستمر التعلم. تُحدَّث كل ليلة من آخر ٦٠ يومًا ({p.brain.posts} منشورًا مقاسًا).</p>
        </div>
      )}

      {p.issues.length > 0 && (
        <div>
          <div className="mb-1 text-sm font-extrabold">المشاكل وحلولها</div>
          <ul className="space-y-1.5">{p.issues.map((i) => (
            <li key={i.id} className="rounded-lg border border-slate-200 p-2 text-sm"><Badge tone={LEVEL[i.level].tone}>{LEVEL[i.level].ar}</Badge> {i.text}<span className="block text-xs text-slate-600">✅ {i.fix}</span></li>
          ))}</ul>
        </div>
      )}

      <div>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-extrabold">أفكار الخطة</span>
          {canCreate && p.ideas.length > 0 && (
            <Button size="sm" disabled={!!busy || !picked.length} onClick={() => run('bank', () => apiCall('/api/accounts-plan/approve', { body: { accountId: p.account.id, keys: picked } }), `اعتُمدت ${picked.length} أفكار — الجدول الآلي يصممها تباعًا`)}>
              اعتمد المختارة ({picked.length}) في بنك الأفكار
            </Button>
          )}
        </div>
        {!p.ideas.length && <p className="text-xs text-slate-500">لا توجد منتجات مسموحة لهذا الحساب — حدّدها في إعدادات الحساب.</p>}
        <ul className="space-y-2">{p.ideas.map((i) => (
          <li key={i.key} className="rounded-lg border border-slate-200 p-2.5 text-sm">
            <div className="flex flex-wrap items-start gap-2">
              {canCreate && !i.inBank && <input id={`${p.account.id}-${i.key}`} type="checkbox" className="mt-1" checked={picked.includes(i.key)} onChange={(e) => setPicked((x) => (e.target.checked ? [...x, i.key] : x.filter((k) => k !== i.key)))} />}
              <label htmlFor={`${p.account.id}-${i.key}`} className="min-w-0 flex-1">
                <b>{i.title}</b> <Badge tone="blue">{FORMAT_AR[i.format] ?? i.format}</Badge> {i.inBank && <Badge tone="green">في البنك</Badge>}
                <span className="block">{i.idea}</span>
                <span className="block text-xs text-slate-600">الافتتاحية: «{i.hook}» · 💡 {i.why}</span>
              </label>
              {canCreate && <Button size="sm" variant="gold" disabled={!!busy} onClick={() => run(i.key, () => apiCall('/api/accounts-plan/design', { body: { accountId: p.account.id, key: i.key } }), 'بدأ التصميم')}>{busy === i.key ? '…' : 'صمّم الآن'}</Button>}
            </div>
          </li>
        ))}</ul>
        <p className="mt-1 text-[11px] text-slate-500">«صمّم الآن» يستخدم الذكاء الاصطناعي (تكلفة تصميم واحد) ويضع التصميم في طابور الموافقات. «اعتمد في البنك» لا يكلف شيئًا الآن: الجدول الآلي يصمم الأفكار المعتمدة في مواعيده.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-dashed border-gold-500 p-3 text-sm">
          <div className="mb-1 flex items-center justify-between"><b>البايو المقترح</b><Copy text={p.bio} /></div>
          <p className="whitespace-pre-line">{p.bio}</p>
        </div>
        <div className="rounded-xl border border-slate-200 p-3 text-sm">
          <b>٣ رسائل لمن يعلّق</b>
          <ol className="mt-1 space-y-1.5">{p.messages.map((m, k) => <li key={k} className="flex items-start gap-2"><span className="min-w-0 flex-1">{k + 1}. {m}</span><Copy text={m} /></li>)}</ol>
        </div>
      </div>
    </div>
  );
}

export function AccountsPlan({ plans, canCreate }: { plans: AccountPlan[]; canCreate: boolean }) {
  const sorted = [...plans].sort((a, b) => b.totals.views - a.totals.views);
  const all = plans.reduce((s, p) => ({ posts: s.posts + p.measured, views: s.views + p.totals.views, conv: s.conv + p.totals.comments + p.totals.shares, saves: s.saves + p.totals.saves }), { posts: 0, views: 0, conv: 0, saves: 0 });
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[['منشورات مقاسة', all.posts], ['مشاهدات', all.views.toLocaleString('en-US')], ['تعليقات ومشاركات', all.conv], ['حفظ', all.saves]].map(([k, v]) => (
          <div key={k as string} className="card p-3"><div className="text-xs text-slate-500">{k}</div><div className="text-xl font-extrabold tabular-nums">{v}</div></div>
        ))}
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[640px] text-sm">
          <thead><tr className="bg-slate-50 text-right text-xs">{['الحساب', 'منشورات', 'مشاهدات', 'حفظ', 'إكمال', 'تخطٍّ', 'أهم مشكلة'].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr></thead>
          <tbody>{sorted.map((p) => (
            <tr key={p.account.id} className="border-t">
              <td className="px-3 py-2"><a href={`#plan-${p.account.id}`} className="font-bold text-navy-700 hover:underline">{p.account.name}</a></td>
              <td className="px-3 py-2 tabular-nums">{p.measured}</td><td className="px-3 py-2 tabular-nums">{p.totals.views}</td><td className="px-3 py-2 tabular-nums">{p.totals.saves}</td>
              <td className="px-3 py-2 tabular-nums">{pct(p.totals.retention)}</td><td className="px-3 py-2 tabular-nums">{pct(p.totals.skip)}</td>
              <td className="px-3 py-2 text-xs">{p.issues[0] ? <><Badge tone={LEVEL[p.issues[0].level].tone}>{LEVEL[p.issues[0].level].ar}</Badge> {p.issues[0].text.slice(0, 70)}</> : '—'}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {sorted.map((p, k) => (
        <details key={p.account.id} id={`plan-${p.account.id}`} className="card p-4" open={k === 0}>
          <summary className="cursor-pointer list-none">
            <span className="text-base font-extrabold">{p.account.name}</span> {p.account.handle && <span className="ltr text-xs text-slate-500">@{p.account.handle}</span>} {p.account.market === 'KSA' && <Badge tone="amber">السعودية</Badge>}
            <span className="ms-2 text-xs text-slate-500">{p.issues.filter((i) => i.level === 'high').length} عاجل · {p.ideas.length} أفكار</span>
          </summary>
          <PlanCard p={p} canCreate={canCreate} />
        </details>
      ))}
    </div>
  );
}
