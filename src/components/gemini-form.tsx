'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiCall } from '@/lib/client/api';
import { Button } from './ui';

type Video = { engine: 'ffmpeg' | 'veo'; veoModel: string; veoDurationSec: 4 | 6 | 8; veoResolution: '720p' | '1080p'; veoPricePerSec: number; maxVeoPerDay: number; nativeAudio: boolean; fallbackToFfmpeg: boolean };

export function GeminiForm({ video, keyStatus }: { video: Video; keyStatus: { configured: boolean; last4: string | null } }) {
  const router = useRouter();
  const [v, setV] = useState<Video>(video);
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const perVideo = (v.veoDurationSec * v.veoPricePerSec).toFixed(2);
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault(); setMsg(null);
      try { await apiCall('/api/settings/gemini', { method: 'PUT', body: { ...v, apiKey: key || undefined } }); setKey(''); setMsg({ ok: true, t: 'تم الحفظ ✓' }); router.refresh(); }
      catch (x) { setMsg({ ok: false, t: (x as Error).message }); }
    }}>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2">
          <label className="label">مفتاح Gemini API {keyStatus.configured && <span className="text-emerald-700">(مُعدّ ✓)</span>}</label>
          <input type="password" autoComplete="off" className="input ltr" placeholder={keyStatus.configured ? 'اتركه فارغًا للإبقاء على المفتاح الحالي' : 'من Google AI Studio ← Get API key'} value={key} onChange={(e) => setKey(e.target.value)} />
          <p className="mt-1 text-xs text-slate-500">يُحفظ مشفّرًا ولا يُعرض مرة أخرى. Veo يتطلب حساب Google AI Studio بفوترة مفعّلة.</p>
        </div>
        <div>
          <label className="label">المحرك الافتراضي للريلز</label>
          <select className="input" value={v.engine} onChange={(e) => setV({ ...v, engine: e.target.value as Video['engine'] })}>
            <option value="ffmpeg">FFmpeg — حركة من الصور (مجاني)</option><option value="veo">Gemini Veo — فيديو ذكاء اصطناعي (مدفوع)</option>
          </select>
        </div>
        <div><label className="label">نموذج Veo</label><input className="input ltr" list="veo-models" value={v.veoModel} onChange={(e) => setV({ ...v, veoModel: e.target.value.trim() })} />
          <datalist id="veo-models"><option value="veo-3.1-fast-generate-preview" /><option value="veo-3.1-generate-preview" /></datalist>
          <p className="mt-1 text-xs text-slate-500">Fast أرخص وأسرع. اضغط «فحص» لرؤية النماذج المتاحة لحسابك.</p></div>
        <div><label className="label">مدة مقطع Veo</label>
          <select className="input" value={v.veoDurationSec} onChange={(e) => setV({ ...v, veoDurationSec: Number(e.target.value) as Video['veoDurationSec'] })}><option value={4}>4 ثوانٍ</option><option value={6}>6 ثوانٍ</option><option value={8}>8 ثوانٍ</option></select>
          <p className="mt-1 text-xs text-slate-500">+3 ثوانٍ شريحة النهاية (الشعار والأرقام).</p></div>
        <div><label className="label">الدقة</label>
          <select className="input" value={v.veoResolution} onChange={(e) => setV({ ...v, veoResolution: e.target.value as Video['veoResolution'] })}><option value="720p">720p</option><option value="1080p">1080p</option></select></div>
        <div><label className="label">السعر لكل ثانية (USD)</label><input type="number" step="0.01" min={0} className="input" value={v.veoPricePerSec} onChange={(e) => setV({ ...v, veoPricePerSec: Number(e.target.value) })} />
          <p className="mt-1 text-xs text-slate-500">تقدير ≈ ${perVideo} للفيديو — تحقّق من صفحة أسعار Gemini.</p></div>
        <div><label className="label">الحد الأقصى يوميًا</label><input type="number" min={0} max={200} className="input" value={v.maxVeoPerDay} onChange={(e) => setV({ ...v, maxVeoPerDay: Number(e.target.value) })} /></div>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.nativeAudio} onChange={(e) => setV({ ...v, nativeAudio: e.target.checked })} /> استخدام صوت Veo الأصلي عندما يكون «نوع الصوت» = بدون صوت</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.fallbackToFfmpeg} onChange={(e) => setV({ ...v, fallbackToFfmpeg: e.target.checked })} /> إذا فشل Veo أنتج ريلز بمحرك FFmpeg (مع تنبيه في فحص الجودة) بدل فشل التصميم</label>
      <div className="flex flex-wrap items-center gap-3">
        <Button>حفظ</Button>
        <Button type="button" variant="outline" onClick={async () => {
          setMsg(null);
          try { const r = await apiCall<{ ok: boolean; message: string }>('/api/settings/gemini/verify', { body: {} }); setMsg({ ok: r.ok, t: r.message }); }
          catch (x) { setMsg({ ok: false, t: (x as Error).message }); }
        }}>فحص المفتاح والنموذج (بدون تكلفة)</Button>
        {keyStatus.configured && <Button type="button" variant="ghost" onClick={async () => { if (!confirm('حذف مفتاح Gemini؟')) return; await apiCall('/api/settings/gemini', { method: 'PUT', body: { ...v, apiKey: '__delete__' } }); router.refresh(); }}>حذف المفتاح</Button>}
        {msg && <span className={msg.ok ? 'text-sm text-emerald-700' : 'text-sm text-red-700'}>{msg.t}</span>}
      </div>
    </form>
  );
}
