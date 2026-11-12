'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiCall } from '@/lib/client/api';
import { Button } from './ui';

type Product = { id: string; titleAr: string; categoryId?: string };
type Category = { id: string; nameAr: string; count?: number };
type Account = {
  id?: string; name: string; platform: string; handle?: string | null; language: string; businessCategory?: string | null; allowedProductIds: string[]; allowedCategoryIds?: string[];
  publishFormat: string; publishIntervalMinutes: number; publishWindowStart: string; publishWindowEnd: string; timezone: string; reelDurationSec: number; maxDailyAds: number; formatStrategy?: string; gbpAuto?: boolean; gbpPerWeek?: number;
};

const EMPTY: Account = { name: '', platform: 'instagram', language: 'ar', allowedProductIds: [], allowedCategoryIds: [], publishFormat: 'IMAGE_STORY', publishIntervalMinutes: 420, publishWindowStart: '09:00', publishWindowEnd: '22:00', timezone: 'Asia/Bahrain', reelDurationSec: 10, maxDailyAds: 4, formatStrategy: 'GROWTH_MIX' };

export function AccountForm({ account, products, categories = [] }: { account?: Account; products: Product[]; categories?: Category[] }) {
  const router = useRouter();
  const [a, setA] = useState<Account>(account ?? EMPTY);
  const [pq, setPq] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const set = <K extends keyof Account>(k: K, v: Account[K]) => setA((x) => ({ ...x, [k]: v }));
  return (
    <form className="grid gap-4 md:grid-cols-3" onSubmit={async (e) => {
      e.preventDefault(); setMsg(null);
      const { id, ...rest } = a;
      const { formatMix: _ignored, ...body } = rest as typeof rest & { formatMix?: unknown }; // mix is edited elsewhere; never send null
      void _ignored;
      try {
        const r = await apiCall<{ id: string }>(id ? `/api/accounts/${id}` : '/api/accounts', { method: id ? 'PATCH' : 'POST', body });
        setMsg({ ok: true, t: 'تم الحفظ ✓' });
        if (!id) router.push(`/accounts/${r.id}`); else router.refresh();
      } catch (x) { setMsg({ ok: false, t: (x as Error).message }); }
    }}>
      <div><label className="label">اسم الحساب</label><input className="input" required value={a.name} onChange={(e) => set('name', e.target.value)} /></div>
      <div><label className="label">المنصة</label>
        <select className="input" value={a.platform} onChange={(e) => set('platform', e.target.value)} disabled={!!a.id}>
          {[['instagram', 'إنستغرام'], ['facebook', 'فيسبوك'], ['tiktok', 'تيك توك'], ['threads', 'ثريدز'], ['youtube', 'يوتيوب'], ['pinterest', 'بنترست'], ['linkedin', 'لينكدإن'], ['twitter', 'X']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select></div>
      <div><label className="label">المعرّف (@handle)</label><input className="input ltr" value={a.handle ?? ''} onChange={(e) => set('handle', e.target.value || null)} /></div>
      <div><label className="label">لغة الإعلانات</label>
        <select className="input" value={a.language} onChange={(e) => set('language', e.target.value)}><option value="ar">العربية</option><option value="en">English</option><option value="ml">മലയാളം Malayalam</option></select></div>
      <div><label className="label">فئة النشاط</label><input className="input" value={a.businessCategory ?? ''} onChange={(e) => set('businessCategory', e.target.value || null)} placeholder="مثال: هدايا، شركات، أعراس" /></div>
      <div><label className="label">صيغة النشر</label>
        <select className="input" value={a.publishFormat} onChange={(e) => set('publishFormat', e.target.value)}>
          <option value="IMAGE_STORY">صورة عمودية 1080×1920</option><option value="IMAGE_FEED">صورة منشور 1080×1350</option><option value="IMAGE_SQUARE">صورة مربعة 1080×1080</option><option value="REEL_VIDEO">فيديو Reel متحرك (MP4)</option><option value="IMAGE_CAROUSEL">كاروسيل 5–6 شرائح 1080×1350</option>
        </select></div>
      <div><label className="label">استراتيجية المحتوى</label>
        <select className="input" value={a.formatStrategy ?? 'FIXED'} onChange={(e) => set('formatStrategy', e.target.value)}>
          <option value="GROWTH_MIX">مزيج النمو: 50% ريلز · 25% كاروسيل · 15% منشور · 10% ستوري (موصى به)</option><option value="FIXED">صيغة ثابتة (صيغة النشر أعلاه فقط)</option>
        </select>
        <p className="mt-1 text-xs text-slate-500">بيانات حساباتك: الريلز وصلت 5–7 أضعاف وصول الصور، والستوري لا تجلب متابعين جددًا.</p></div>
      <div><label className="label">النشر كل</label>
        <select className="input" value={a.publishIntervalMinutes} onChange={(e) => { const m = Number(e.target.value); setA((x) => ({ ...x, publishIntervalMinutes: m, maxDailyAds: Math.max(1, Math.ceil(1440 / m)) })); }}>
          {[...new Set([3, 4, 5, 6, 7, 8, 9, 12, 24, 48].map((h) => h * 60).concat(a.publishIntervalMinutes))].sort((x, y) => x - y).map((m) => <option key={m} value={m}>{m % 60 ? `${m} دقيقة` : `${m / 60} ساعات`}</option>)}
        </select></div>
      <div><label className="label">بداية نافذة النشر</label><input type="time" className="input ltr" value={a.publishWindowStart} onChange={(e) => set('publishWindowStart', e.target.value)} /></div>
      <div><label className="label">نهاية نافذة النشر</label><input type="time" className="input ltr" value={a.publishWindowEnd} onChange={(e) => set('publishWindowEnd', e.target.value)} /></div>
      <div><label className="label">مدة الـReel (ثانية)</label><input type="number" min={6} max={60} className="input" value={a.reelDurationSec} onChange={(e) => set('reelDurationSec', Number(e.target.value))} /></div>
      <div><label className="label">الحد الأقصى اليومي</label><input type="number" min={1} max={48} className="input" value={a.maxDailyAds} onChange={(e) => set('maxDailyAds', Number(e.target.value))} /></div>
      <div><label className="label">المنطقة الزمنية</label><input className="input ltr" value={a.timezone} onChange={(e) => set('timezone', e.target.value)} /></div>
      <div className="rounded-lg border p-3 md:col-span-3">
        <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={!!a.gbpAuto} onChange={(e) => set('gbpAuto', e.target.checked)} /> نشر تلقائي على ملف Google التجاري (خرائط وبحث Google)</label>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span>عدد التحديثات أسبوعيًا:</span>
          <select className="input" style={{ width: '6rem' }} value={a.gbpPerWeek ?? 2} onChange={(e) => set('gbpPerWeek', Number(e.target.value))}>{[1, 2, 3, 4, 5, 7].map((n) => <option key={n} value={n}>{n}</option>)}</select>
          <span className="text-xs text-slate-500">Google يوصي بـ 1–2 أسبوعيًا. تُنشر نسخة مناسبة لـ Google: بلا أرقام هواتف ولا وسوم، مع سطر الفرعين للبحث المحلي. الصور (منشور/مربع) تحديثات، والريلز تذهب لمعرض الصور. يحتاج ربط Google Business بالعلامة في Metricool.</span>
        </div>
      </div>
      <div className="md:col-span-3">
        <label className="label">الفئات المسموح بها (تشمل كل منتجاتها، بما فيها التي تُضاف لاحقًا)</label>
        <div className="flex flex-wrap gap-2 rounded-lg border p-2">
          {categories.map((c) => { const cats = a.allowedCategoryIds ?? []; return (
            <label key={c.id} className={`flex items-center gap-1 rounded-full border px-3 py-1 text-sm ${cats.includes(c.id) ? 'border-navy-700 bg-navy-50' : ''}`}>
              <input type="checkbox" checked={cats.includes(c.id)} onChange={(e) => set('allowedCategoryIds', e.target.checked ? [...cats, c.id] : cats.filter((x) => x !== c.id))} />{c.nameAr}{c.count !== undefined && <span className="text-xs text-slate-500">({c.count})</span>}
            </label>); })}
          {!categories.length && <span className="text-xs text-slate-500">لا توجد فئات بعد.</span>}
        </div>
      </div>
      <div className="md:col-span-3">
        <label className="label">منتجات إضافية محددة ({a.allowedProductIds.length} مختار) — بدون اختيار فئة أو منتج = كل المنتجات النشطة</label>
        <input className="input mb-2" style={{ width: '18rem' }} placeholder="ابحث عن منتج…" value={pq} onChange={(e) => setPq(e.target.value)} />
        <div className="grid max-h-56 grid-cols-2 gap-1 overflow-y-auto rounded-lg border p-2 md:grid-cols-4">
          {(() => { const q = pq.trim().toLowerCase(); const cats = a.allowedCategoryIds ?? [];
            const list = products.filter((p) => a.allowedProductIds.includes(p.id) || (!q ? true : p.titleAr.toLowerCase().includes(q)));
            const shown = q ? list.slice(0, 200) : [...products.filter((p) => a.allowedProductIds.includes(p.id)), ...products.filter((p) => !a.allowedProductIds.includes(p.id))].slice(0, 120);
            return <>{shown.map((p) => { const viaCat = !!p.categoryId && cats.includes(p.categoryId); return (
              <label key={p.id} className={`flex items-center gap-2 text-sm ${viaCat ? 'text-slate-400' : ''}`} title={viaCat ? 'مسموح عبر الفئة' : undefined}>
                <input type="checkbox" disabled={viaCat} checked={viaCat || a.allowedProductIds.includes(p.id)} onChange={(e) => set('allowedProductIds', e.target.checked ? [...a.allowedProductIds, p.id] : a.allowedProductIds.filter((x) => x !== p.id))} />{p.titleAr}
              </label>); })}
              {products.length > shown.length && <span className="col-span-full text-xs text-slate-500">يُعرض {shown.length} من {products.length} — استخدم البحث للوصول لبقية المنتجات.</span>}</>;
          })()}
        </div>
      </div>
      <div className="flex items-center gap-3 md:col-span-3"><Button>{a.id ? 'حفظ التعديلات' : 'إضافة الحساب'}</Button>{msg && <span className={msg.ok ? 'text-sm text-emerald-700' : 'text-sm text-red-700'}>{msg.t}</span>}</div>
    </form>
  );
}
