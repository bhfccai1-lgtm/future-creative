'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiCall } from '@/lib/client/api';
import { Button, Badge } from './ui';

type Row = { id: string; name: string; intervalHours: number; niche: string | null; categories: string[]; keepsExisting: boolean };
export function RecommendedSetup() {
  const router = useRouter();
  const [plan, setPlan] = useState<Row[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const call = async (dryRun: boolean) => {
    setBusy(true); setMsg(null);
    try {
      const r = await apiCall<{ plan: Row[]; applied?: boolean }>('/api/automation', { body: { action: 'recommended', dryRun } });
      setPlan(r.plan);
      if (r.applied) { setMsg({ ok: true, t: `تم تطبيق الإعداد على ${r.plan.length} حساب ✓` }); router.refresh(); }
    } catch (x) { setMsg({ ok: false, t: (x as Error).message }); }
    setBusy(false);
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">ضغطة واحدة لكل الحسابات: <b>كل 7 ساعات</b> · <b>تنويع ذكي للصيغ</b> (Reel · كاروسيل · منشور · ستوري) · <b>فئات مناسبة لكل حساب</b> حسب اسمه. الحسابات العامة والفروع تبقى على كل المنتجات، والحسابات التي اخترت لها فئات سابقًا لا تُغيَّر فئاتها.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={() => call(true)}>معاينة الإعداد الموصى به</Button>
        {plan && !msg?.ok && <Button type="button" variant="gold" disabled={busy} onClick={() => call(false)}>تطبيق على {plan.length} حساب</Button>}
      </div>
      {msg && <p className={msg.ok ? 'text-sm text-emerald-700' : 'text-sm text-red-700'}>{msg.t}</p>}
      {plan && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm"><thead><tr><th className="th">الحساب</th><th className="th">التكرار</th><th className="th">الصيغة</th><th className="th">الفئات</th></tr></thead>
            <tbody>{plan.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="td font-bold">{r.name}{r.niche && <span className="mr-2"><Badge tone="blue">{r.niche}</Badge></span>}</td>
                <td className="td">كل {r.intervalHours} ساعات</td>
                <td className="td">تنويع ذكي</td>
                <td className="td text-xs">{r.keepsExisting ? 'تبقى فئاتك الحالية' : r.categories.length ? r.categories.join('، ') : 'كل المنتجات'}</td>
              </tr>))}</tbody></table>
        </div>)}
    </div>
  );
}
