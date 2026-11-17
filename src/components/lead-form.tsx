'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from './ui';
import { toast } from './toaster';
import { apiCall } from '@/lib/client/api';

const SRC: [string, string][] = [['phone', 'اتصال'], ['whatsapp', 'واتساب'], ['walkin', 'زيارة الفرع'], ['dm', 'رسالة إنستغرام'], ['other', 'أخرى']];

/** Quick add: a customer who called, messaged or visited — and which account brought them. */
export function LeadForm({ accounts, products }: { accounts: { id: string; name: string }[]; products: { id: string; name: string }[] }) {
  const router = useRouter();
  const empty = { name: '', contact: '', need: '', source: 'phone', accountId: '', productId: '' };
  const [v, setV] = useState(empty);
  const [pending, start] = useTransition();
  return (
    <form className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        try { const r = await apiCall<{ message: string }>('/api/leads', { method: 'POST', body: v }); toast(r.message); setV(empty); router.refresh(); }
        catch (x) { toast((x as Error).message, 'error'); }
      });
    }}>
      <input className="input" placeholder="اسم العميل (اختياري)" value={v.name} maxLength={80} onChange={(e) => setV({ ...v, name: e.target.value })} />
      <input className="input ltr" placeholder="رقم الهاتف أو الحساب" value={v.contact} maxLength={80} onChange={(e) => setV({ ...v, contact: e.target.value })} />
      <select className="input" value={v.source} onChange={(e) => setV({ ...v, source: e.target.value })}>{SRC.map(([k, ar]) => <option key={k} value={k}>تواصل عبر: {ar}</option>)}</select>
      <input className="input sm:col-span-2" required minLength={2} maxLength={500} placeholder="ماذا يريد؟ مثال: 50 كوب مطبوع بشعار الشركة قبل العيد" value={v.need} onChange={(e) => setV({ ...v, need: e.target.value })} />
      <select className="input" value={v.productId} onChange={(e) => setV({ ...v, productId: e.target.value })}><option value="">المنتج (اختياري)</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      <select className="input sm:col-span-2" value={v.accountId} onChange={(e) => setV({ ...v, accountId: e.target.value })}><option value="">من أي حساب عرفنا؟ (مهم لمعرفة الحساب الأكثر جلبًا للطلبات)</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
      <Button type="submit" variant="gold" disabled={pending}>{pending ? '...' : '+ إضافة عميل'}</Button>
    </form>
  );
}
