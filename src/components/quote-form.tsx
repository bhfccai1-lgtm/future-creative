'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from './ui';
import { toast } from './toaster';
import { apiCall } from '@/lib/client/api';

type Item = { desc: string; qty: string; unit: string };
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const n = (v: string) => { const x = Number(v.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[٫,]/g, '.')); return Number.isFinite(x) ? x : 0; };

/** Quote builder: the owner types each line (description, quantity, unit price). Nothing is priced by the system. */
export function QuoteForm({ leadId, initial, suggestions }: { leadId: string; initial: { items: { desc: string; qty: number; unit: number }[]; discount: number; notes: string } | null; suggestions: string[] }) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>(initial?.items.map((i) => ({ desc: i.desc, qty: String(i.qty), unit: String(i.unit) })) ?? [{ desc: suggestions[0] ?? '', qty: '', unit: '' }]);
  const [discount, setDiscount] = useState(String(initial?.discount ?? ''));
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [pending, start] = useTransition();
  const subtotal = r3(items.reduce((s, i) => s + n(i.qty) * n(i.unit), 0));
  const total = r3(Math.max(0, subtotal - Math.min(n(discount), subtotal)));
  const set = (k: number, f: keyof Item, v: string) => setItems(items.map((x, i) => (i === k ? { ...x, [f]: v } : x)));
  return (
    <form className="space-y-3" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        try {
          const r = await apiCall<{ message: string }>(`/api/leads/${leadId}/quote`, { method: 'PUT', body: { items: items.filter((i) => i.desc.trim()).map((i) => ({ desc: i.desc, qty: n(i.qty), unit: n(i.unit) })), discount: n(discount), notes } });
          toast(r.message); router.push(`/q/${leadId}`);
        } catch (x) { toast((x as Error).message, 'error'); }
      });
    }}>
      <datalist id="quote-desc">{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
      {items.map((it, k) => (
        <div key={k} className="grid grid-cols-12 gap-2 rounded-lg border p-2">
          <input className="input col-span-12 sm:col-span-6" list="quote-desc" required maxLength={120} placeholder="البند: مثال: أكواب سيراميك مطبوعة بشعار — طباعة بالتسامي" value={it.desc} onChange={(e) => set(k, 'desc', e.target.value)} />
          <input className="input col-span-4 sm:col-span-2 ltr" inputMode="numeric" required placeholder="الكمية" value={it.qty} onChange={(e) => set(k, 'qty', e.target.value)} />
          <input className="input col-span-5 sm:col-span-2 ltr" inputMode="decimal" required placeholder="سعر الوحدة" value={it.unit} onChange={(e) => set(k, 'unit', e.target.value)} />
          <div className="col-span-3 flex items-center justify-between gap-1 sm:col-span-2"><span className="ltr text-xs font-bold">{r3(n(it.qty) * n(it.unit)).toFixed(3)}</span>{items.length > 1 && <button type="button" className="text-red-600" aria-label="حذف البند" onClick={() => setItems(items.filter((_, i) => i !== k))}>✕</button>}</div>
        </div>
      ))}
      {items.length < 30 && <button type="button" className="text-sm font-bold text-gold-600 underline" onClick={() => setItems([...items, { desc: '', qty: '', unit: '' }])}>+ بند آخر</button>}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div><label className="label">خصم (د.ب) — اختياري</label><input className="input ltr" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} /></div>
        <div className="rounded-lg bg-navy-50 p-3 text-sm"><div className="flex justify-between"><span>المجموع</span><span className="ltr">{subtotal.toFixed(3)}</span></div><div className="flex justify-between text-base font-extrabold text-navy-900"><span>الإجمالي (د.ب)</span><span className="ltr">{total.toFixed(3)}</span></div></div>
      </div>
      <div><label className="label">ملاحظات للعميل (اختياري)</label><textarea className="input" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="مثال: يشمل التصميم وتجربة الطباعة قبل الإنتاج. التسليم خلال 5 أيام عمل من اعتماد التصميم." /></div>
      <Button type="submit" variant="gold" disabled={pending}>{pending ? '...' : 'حفظ وعرض العرض للطباعة / الإرسال'}</Button>
    </form>
  );
}
