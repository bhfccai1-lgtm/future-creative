'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from './ui';
import { toast } from './toaster';
import { apiCall } from '@/lib/client/api';

/** Start form for the 30-day growth program: choose accounts and (optionally) switch on the daily designs. */
export function GrowthStart({ accounts, canAutomate }: { accounts: { id: string; name: string; tier: string; auto: boolean }[]; canAutomate: boolean }) {
  const router = useRouter();
  const [ids, setIds] = useState<string[]>(accounts.map((a) => a.id));
  const [daily, setDaily] = useState(canAutomate);
  const [pending, start] = useTransition();
  const toggle = (id: string) => setIds((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {accounts.map((a) => (
          <label key={a.id} className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${ids.includes(a.id) ? 'border-navy-800 bg-navy-50 font-bold' : 'bg-white text-slate-500'}`}>
            <input type="checkbox" checked={ids.includes(a.id)} onChange={() => toggle(a.id)} />{a.name}<span className="text-[11px] text-slate-500">{a.tier}</span>
          </label>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap gap-3 text-xs">
        <button type="button" className="font-bold text-gold-600 underline" onClick={() => setIds(accounts.map((a) => a.id))}>اختيار الكل</button>
        <button type="button" className="font-bold text-slate-500 underline" onClick={() => setIds([])}>إلغاء الكل</button>
      </div>
      {canAutomate && (
        <label className="mb-3 flex items-start gap-2 rounded-lg border p-3 text-sm">
          <input type="checkbox" className="mt-1" checked={daily} onChange={(e) => setDaily(e.target.checked)} />
          <span><b>شغّل التوليد اليومي للحسابات المختارة المرتبطة</b> — يصمم النظام تلقائيًا حسب الخطة. النشر يبقى حسب «وضع النشر» في الإعدادات: في الوضع اليدوي/المساعد كل تصميم ينتظر موافقتك في طابور الموافقات.</span>
        </label>
      )}
      <Button variant="gold" disabled={pending || !ids.length} onClick={() => {
        if (!window.confirm(`بدء برنامج النمو لـ ${ids.length} حساب لمدة 30 يومًا؟ يُطبَّق إيقاع النشر ومزيج الصيغ المقترح، وتُحفظ أرقام اليوم كنقطة بداية.`)) return;
        start(async () => {
          try { const r = await apiCall<{ message: string }>('/api/growth/program', { method: 'POST', body: { accountIds: ids, enableDaily: daily } }); toast(r.message); router.refresh(); }
          catch (e) { toast((e as Error).message, 'error'); }
        });
      }}>{pending ? '...' : `🚀 ابدأ برنامج النمو (${ids.length} حساب · 30 يومًا)`}</Button>
    </div>
  );
}
