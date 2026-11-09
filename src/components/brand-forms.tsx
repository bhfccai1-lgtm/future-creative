'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiCall } from '@/lib/client/api';
import { Button } from './ui';

export function LogoUpload() {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setMsg(null);
      try { await apiCall('/api/brand/logo', { form: new FormData(e.currentTarget) }); setMsg({ ok: true, t: 'تم الرفع والتحقق. راجع المعاينة ثم اعتمد الشعار.' }); router.refresh(); }
      catch (x) { setMsg({ ok: false, t: (x as Error).message }); }
      setBusy(false);
    }}>
      <input type="file" name="file" accept="image/png" required className="block w-full text-sm" />
      <p className="text-xs text-slate-500">ارفع ملف الشعار الأصلي بصيغة PNG بخلفية شفافة. لن يُعدّل النظام ألوانه أو نسبه أو نصوصه، وسيحفظ بصمته SHA-256.</p>
      <Button disabled={busy}>{busy ? 'جارٍ الرفع…' : 'رفع الشعار'}</Button>
      {msg && <p className={msg.ok ? 'text-sm text-emerald-700' : 'rounded bg-red-50 p-2 text-sm text-red-700'}>{msg.t}</p>}
    </form>
  );
}

type Loc = { key: string; nameAr: string; nameEn: string; nameMl?: string; phone: string };
export function BusinessForm({ b }: { b: { nameAr: string; nameEn: string; defaultCtaAr: string; defaultCtaEn: string; defaultCtaMl: string; locations: Loc[] } }) {
  const router = useRouter();
  const [v, setV] = useState(b);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const setLoc = (i: number, k: keyof Loc, val: string) => setV((x) => ({ ...x, locations: x.locations.map((l, j) => (j === i ? { ...l, [k]: val } : l)) }));
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault(); setMsg(null);
      try { await apiCall('/api/brand/business', { method: 'PUT', body: v }); setMsg({ ok: true, t: 'تم الحفظ ✓' }); router.refresh(); }
      catch (x) { setMsg({ ok: false, t: (x as Error).message }); }
    }}>
      <div className="grid gap-3 md:grid-cols-2">
        <div><label className="label">الاسم العربي</label><input className="input" value={v.nameAr} onChange={(e) => setV({ ...v, nameAr: e.target.value })} /></div>
        <div><label className="label">English name</label><input className="input ltr" value={v.nameEn} onChange={(e) => setV({ ...v, nameEn: e.target.value })} /></div>
        <div><label className="label">عبارة الحث (عربي)</label><input className="input" value={v.defaultCtaAr} onChange={(e) => setV({ ...v, defaultCtaAr: e.target.value })} /></div>
        <div><label className="label">CTA (English)</label><input className="input ltr" value={v.defaultCtaEn} onChange={(e) => setV({ ...v, defaultCtaEn: e.target.value })} /></div>
        <div><label className="label">CTA (Malayalam)</label><input className="input" value={v.defaultCtaMl} onChange={(e) => setV({ ...v, defaultCtaMl: e.target.value })} /></div>
      </div>
      <div>
        <label className="label">الفروع وأرقام التواصل (تُضاف تلقائيًا لكل إعلان)</label>
        {v.locations.map((l, i) => (
          <div key={l.key} className="mb-2 grid gap-2 md:grid-cols-5">
            <input className="input ltr" value={l.key} disabled />
            <input className="input" value={l.nameAr} onChange={(e) => setLoc(i, 'nameAr', e.target.value)} placeholder="الاسم بالعربية" />
            <input className="input ltr" value={l.nameEn} onChange={(e) => setLoc(i, 'nameEn', e.target.value)} placeholder="English" />
            <input className="input" value={l.nameMl ?? ''} onChange={(e) => setLoc(i, 'nameMl', e.target.value)} placeholder="Malayalam" />
            <input className="input ltr" value={l.phone} onChange={(e) => setLoc(i, 'phone', e.target.value)} pattern="\d{8}" title="8 أرقام" />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3"><Button>حفظ بيانات الهوية</Button>{msg && <span className={msg.ok ? 'text-sm text-emerald-700' : 'text-sm text-red-700'}>{msg.t}</span>}</div>
    </form>
  );
}
