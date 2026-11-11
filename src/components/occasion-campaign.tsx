'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiCall } from '@/lib/client/api';
import { Button } from './ui';

type Acc = { id: string; name: string };
type Cat = { id: string; name: string };
export function OccasionCampaign({ occasion, title, startAt, endAt, accounts, defaultAccounts, categories }: { occasion: string; title: string; startAt: string; endAt: string; accounts: Acc[]; defaultAccounts: string[]; categories: Cat[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string[]>(defaultAccounts);
  const [cat, setCat] = useState(categories[0]?.id ?? '');
  const [every, setEvery] = useState(24);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  if (!open) return <Button type="button" size="sm" variant="gold" onClick={() => setOpen(true)}>إنشاء حملة لهذه المناسبة</Button>;
  return (
    <div className="mt-2 space-y-2 rounded-lg border bg-slate-50 p-3 text-sm">
      <div className="font-bold">الحسابات ({sel.length})</div>
      <div className="flex flex-wrap gap-2">{accounts.map((a) => (
        <label key={a.id} className="flex items-center gap-1"><input type="checkbox" checked={sel.includes(a.id)} onChange={(e) => setSel(e.target.checked ? [...sel, a.id] : sel.filter((x) => x !== a.id))} />{a.name}</label>))}</div>
      <div className="flex flex-wrap items-end gap-3">
        <div><label className="label">فئة المنتج</label><select className="input" style={{ width: '15rem' }} value={cat} onChange={(e) => setCat(e.target.value)}><option value="">تلقائي — فئات كل حساب</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div><label className="label">التكرار</label><select className="input" style={{ width: '10rem' }} value={every} onChange={(e) => setEvery(Number(e.target.value))}><option value={24}>مرة يوميًا</option><option value={48}>كل يومين</option><option value={12}>مرتين يوميًا</option></select></div>
        <Button type="button" size="sm" disabled={!sel.length} onClick={async () => {
          try {
            await apiCall('/api/campaigns', { body: {
              name: title, accountIds: sel, productId: null, format: null, language: null, scheduleType: 'RECURRING', everyHours: every, daysOfWeek: [], timeMode: 'BEST',
              startAt, endAt, maxRuns: null,
              direction: { occasion, autoFormat: true, designStyle: 'auto', renderMode: 'auto', ...(cat ? { categoryId: cat } : {}) },
            } });
            setMsg({ ok: true, t: 'أُنشئت الحملة ✓ — تصاميمها تذهب للموافقة حسب وضع النشر.' }); router.refresh();
          } catch (x) { setMsg({ ok: false, t: (x as Error).message }); }
        }}>تأكيد إنشاء الحملة</Button>
      </div>
      {msg && <p className={msg.ok ? 'text-emerald-700' : 'text-red-700'}>{msg.t}</p>}
    </div>
  );
}
