'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from './ui';
import { toast } from './toaster';
import { apiCall } from '@/lib/client/api';

export function SalesSettings({ initial }: { initial: { monthlyTargetBhd: number; quoteValidityDays: number; quoteTerms: string; reactivationDays: number } }) {
  const router = useRouter();
  const [v, setV] = useState({ ...initial, monthlyTargetBhd: String(initial.monthlyTargetBhd || ''), quoteValidityDays: String(initial.quoteValidityDays), reactivationDays: String(initial.reactivationDays) });
  const [pending, start] = useTransition();
  return (
    <form className="grid grid-cols-1 gap-2 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); start(async () => { try { const r = await apiCall<{ message: string }>('/api/settings/sales', { method: 'PUT', body: { monthlyTargetBhd: Number(v.monthlyTargetBhd || 0), quoteValidityDays: Number(v.quoteValidityDays), reactivationDays: Number(v.reactivationDays), quoteTerms: v.quoteTerms } }); toast(r.message); router.refresh(); } catch (x) { toast((x as Error).message, 'error'); } }); }}>
      <div><label className="label">هدف المبيعات الشهري (د.ب)</label><input className="input ltr" inputMode="decimal" value={v.monthlyTargetBhd} onChange={(e) => setV({ ...v, monthlyTargetBhd: e.target.value })} placeholder="مثال: 3000" /></div>
      <div><label className="label">صلاحية عرض السعر (أيام)</label><input className="input ltr" inputMode="numeric" value={v.quoteValidityDays} onChange={(e) => setV({ ...v, quoteValidityDays: e.target.value })} /></div>
      <div><label className="label">تذكير بالعميل السابق بعد (أيام)</label><input className="input ltr" inputMode="numeric" value={v.reactivationDays} onChange={(e) => setV({ ...v, reactivationDays: e.target.value })} /></div>
      <div className="sm:col-span-3"><label className="label">شروط عرض السعر (تظهر أسفل كل عرض)</label><textarea className="input" rows={2} maxLength={600} value={v.quoteTerms} onChange={(e) => setV({ ...v, quoteTerms: e.target.value })} /></div>
      <Button type="submit" variant="outline" disabled={pending}>{pending ? '...' : 'حفظ إعدادات المبيعات'}</Button>
    </form>
  );
}
