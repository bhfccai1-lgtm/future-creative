'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiCall } from '@/lib/client/api';
import { Button } from './ui';

type Product = { id: string; titleAr: string };
type Account = {
  id?: string; name: string; platform: string; handle?: string | null; language: string; businessCategory?: string | null; allowedProductIds: string[];
  publishFormat: string; publishIntervalMinutes: number; publishWindowStart: string; publishWindowEnd: string; timezone: string; reelDurationSec: number; maxDailyAds: number; formatStrategy?: string;
};

const EMPTY: Account = { name: '', platform: 'instagram', language: 'ar', allowedProductIds: [], publishFormat: 'IMAGE_STORY', publishIntervalMinutes: 420, publishWindowStart: '09:00', publishWindowEnd: '22:00', timezone: 'Asia/Bahrain', reelDurationSec: 10, maxDailyAds: 4, formatStrategy: 'GROWTH_MIX' };

export function AccountForm({ account, products }: { account?: Account; products: Product[] }) {
  const router = useRouter();
  const [a, setA] = useState<Account>(account ?? EMPTY);
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
      <div><label className="label">فترة النشر (دقائق)</label><input type="number" min={60} step={30} className="input" value={a.publishIntervalMinutes} onChange={(e) => set('publishIntervalMinutes', Number(e.target.value))} /></div>
      <div><label className="label">بداية نافذة النشر</label><input type="time" className="input ltr" value={a.publishWindowStart} onChange={(e) => set('publishWindowStart', e.target.value)} /></div>
      <div><label className="label">نهاية نافذة النشر</label><input type="time" className="input ltr" value={a.publishWindowEnd} onChange={(e) => set('publishWindowEnd', e.target.value)} /></div>
      <div><label className="label">مدة الـReel (ثانية)</label><input type="number" min={6} max={60} className="input" value={a.reelDurationSec} onChange={(e) => set('reelDurationSec', Number(e.target.value))} /></div>
      <div><label className="label">الحد الأقصى اليومي</label><input type="number" min={1} max={48} className="input" value={a.maxDailyAds} onChange={(e) => set('maxDailyAds', Number(e.target.value))} /></div>
      <div><label className="label">المنطقة الزمنية</label><input className="input ltr" value={a.timezone} onChange={(e) => set('timezone', e.target.value)} /></div>
      <div className="md:col-span-3">
        <label className="label">المنتجات المسموح بها (بدون اختيار = كل المنتجات النشطة)</label>
        <div className="grid max-h-48 grid-cols-2 gap-1 overflow-y-auto rounded-lg border p-2 md:grid-cols-4">
          {products.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={a.allowedProductIds.includes(p.id)} onChange={(e) => set('allowedProductIds', e.target.checked ? [...a.allowedProductIds, p.id] : a.allowedProductIds.filter((x) => x !== p.id))} />{p.titleAr}
            </label>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3 md:col-span-3"><Button>{a.id ? 'حفظ التعديلات' : 'إضافة الحساب'}</Button>{msg && <span className={msg.ok ? 'text-sm text-emerald-700' : 'text-sm text-red-700'}>{msg.t}</span>}</div>
    </form>
  );
}
