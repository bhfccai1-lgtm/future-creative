'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiCall } from '@/lib/client/api';
import { Button } from './ui';

type Opt = { id: string; label: string };

/** "إنشاء إعلان الآن": enqueues generation on the worker and polls until the worker reports the result. */
export function GenerateForm({ accounts, products }: { accounts: Opt[]; products: Opt[] }) {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form className="grid gap-4 md:grid-cols-4" onSubmit={async (e) => {
      e.preventDefault(); setErr(null); setBusy(true); setStatus('تم إرسال الطلب إلى عامل التوليد…');
      const f = new FormData(e.currentTarget);
      try {
        const { jobId } = await apiCall<{ jobId: string }>('/api/ads/generate', { body: { accountId: f.get('accountId'), productId: f.get('productId') || undefined, format: f.get('format') || undefined } });
        for (let i = 0; i < 180; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const j = await apiCall<{ state: string; result: { adId: string; state: string } | null; failedReason: string | null }>(`/api/jobs/${jobId}`).catch(() => null);
          if (!j) continue;
          if (j.state === 'completed' && j.result) { router.push(`/ads/${j.result.adId}`); return; }
          if (j.state === 'failed') { setErr(j.failedReason ?? 'فشل التوليد'); setBusy(false); setStatus(null); return; }
          setStatus(j.state === 'active' ? 'جارٍ التوليد: الفكرة ← المشهد ← التركيب ← فحص الجودة…' : 'بانتظار عامل التوليد (تأكد أن خدمة worker تعمل)…');
        }
        setErr('انتهت مهلة الانتظار — راجع مكتبة التصاميم لاحقًا.');
      } catch (x) { setErr((x as Error).message); }
      setBusy(false);
    }}>
      <div><label className="label">الحساب</label><select name="accountId" required className="input">{accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></div>
      <div><label className="label">المنتج</label><select name="productId" className="input"><option value="">اختيار تلقائي بالذكاء الاصطناعي</option>{products.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></div>
      <div><label className="label">الصيغة</label><select name="format" className="input"><option value="">حسب إعداد الحساب</option><option value="IMAGE_STORY">صورة عمودية 1080×1920</option><option value="IMAGE_FEED">صورة منشور 1080×1350</option><option value="IMAGE_SQUARE">صورة مربعة</option><option value="REEL_VIDEO">فيديو Reel متحرك</option></select></div>
      <div className="flex items-end"><Button variant="gold" size="lg" className="w-full" disabled={busy}>{busy ? 'جارٍ الإنشاء…' : 'إنشاء إعلان الآن'}</Button></div>
      {status && <p className="text-sm text-navy-700 md:col-span-4">{status}</p>}
      {err && <p className="rounded bg-red-50 p-2 text-sm text-red-700 md:col-span-4">{err}</p>}
    </form>
  );
}
