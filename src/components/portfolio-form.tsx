'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from './ui';
import { toast } from './toaster';
import { apiCall } from '@/lib/client/api';

const FORMATS: [string, string][] = [['IMAGE_FEED', 'منشور 4:5'], ['IMAGE_STORY', 'ستوري'], ['IMAGE_SQUARE', 'مربع'], ['REEL_VIDEO', 'ريل (حركة من الصورة)']];

/** Upload a real photo of a finished job; one branded post per chosen account goes to the approval queue. */
export function PortfolioForm({ accounts, products }: { accounts: { id: string; name: string }[]; products: { id: string; name: string }[] }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [ids, setIds] = useState<string[]>([]);
  const [format, setFormat] = useState('IMAGE_FEED');
  const [productId, setProductId] = useState('');
  const [note, setNote] = useState('');
  const [consent, setConsent] = useState(false);
  const [pending, start] = useTransition();
  return (
    <form className="space-y-3" onSubmit={(e) => {
      e.preventDefault();
      if (!file) return toast('أرفق صورة العمل المنجز', 'error');
      if (!ids.length) return toast('اختر حسابًا واحدًا على الأقل', 'error');
      start(async () => {
        const fd = new FormData();
        fd.set('file', file); fd.set('accountIds', ids.join(',')); fd.set('format', format); fd.set('productId', productId); fd.set('note', note); fd.set('clientConsent', String(consent));
        try { const j = await apiCall<{ message: string }>('/api/portfolio', { form: fd }); toast(j.message); setFile(null); setPreview(null); setNote(''); setConsent(false); router.refresh(); }
        catch (x) { toast((x as Error).message, 'error'); }
      });
    }}>
      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gold-300 bg-gold-300/5 p-4 text-center">
        {preview ? <img src={preview} alt="" className="max-h-72 rounded-lg object-contain" /> : <><span className="text-3xl">📷</span><span className="text-sm font-bold text-navy-800">صورة حقيقية لعمل منجز</span><span className="text-xs text-slate-500">صورة واضحة بإضاءة جيدة — المنتج المطبوع في المنتصف (JPG / PNG، حتى 15MB)</span></>}
        <input type="file" accept="image/jpeg,image/png,image/webp,image/heic" className="hidden" onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); setPreview(f ? URL.createObjectURL(f) : null); }} />
      </label>
      <div>
        <div className="label">الحسابات</div>
        <div className="flex flex-wrap gap-2">{accounts.map((a) => (
          <label key={a.id} className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${ids.includes(a.id) ? 'border-navy-800 bg-navy-50 font-bold' : 'bg-white text-slate-600'}`}>
            <input type="checkbox" checked={ids.includes(a.id)} onChange={() => setIds((x) => (x.includes(a.id) ? x.filter((y) => y !== a.id) : [...x, a.id]))} />{a.name}
          </label>
        ))}</div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <select className="input" value={format} onChange={(e) => setFormat(e.target.value)}>{FORMATS.map(([k, ar]) => <option key={k} value={k}>{ar}</option>)}</select>
        <select className="input" value={productId} onChange={(e) => setProductId(e.target.value)}><option value="">نوع المنتج (يحسّن النص)</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      </div>
      <textarea className="input" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="عن العمل (اختياري): مثال: 200 كوب بشعار شركة لفعالية اليوم الوطني، طباعة بالتسامي، سُلّمت خلال 3 أيام" />
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>العميل وافق على ذكر اسمه — وإلا يكتب النظام «لأحد عملائنا» ولا يذكر أي اسم.</span></label>
      <Button type="submit" variant="gold" disabled={pending}>{pending ? '...' : `✨ اصنع منشور «أعمال منجزة»${ids.length > 1 ? ` لـ ${ids.length} حسابات` : ''}`}</Button>
    </form>
  );
}
