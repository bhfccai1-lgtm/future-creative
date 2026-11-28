'use client';
import { useEffect, useState } from 'react';
import { apiCall } from '@/lib/client/api';
import { toast } from './toaster';

type Insp = { enabled: boolean; count: number; freeOnly: boolean };
type Key = { configured: boolean; last4: string | null };

/**
 * «🔎 الإلهام من Freepik» — visual research before every design. The key is write-only (stored encrypted, never shown
 * again); the research stays off until a key is saved and the owner switches it on.
 */
export function InspirationSettings() {
  const [v, setV] = useState<Insp | null>(null);
  const [key, setKey] = useState<Key>({ configured: false, last4: null });
  const [newKey, setNewKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; message: string; sample?: { title: string; url: string; license: string }[] } | null>(null);
  useEffect(() => { apiCall<{ inspiration: Insp; key: Key }>('/api/settings/inspiration').then((r) => { setV(r.inspiration); setKey(r.key); }).catch(() => setV({ enabled: false, count: 8, freeOnly: false })); }, []);
  if (!v) return <p className="text-xs text-slate-500">جارٍ التحميل…</p>;
  const save = async (patch: Partial<Insp> & { apiKey?: string } = {}) => {
    setBusy(true);
    try {
      const r = await apiCall<{ inspiration: Insp; key: Key }>('/api/settings/inspiration', { method: 'PUT', body: { ...v, ...patch, ...(newKey.trim() ? { apiKey: newKey.trim() } : {}) } });
      setV(r.inspiration); setKey(r.key); setNewKey('');
      toast(patch.enabled && !r.inspiration.enabled ? 'احفظ مفتاح Freepik أولًا' : 'تم الحفظ ✓', patch.enabled && !r.inspiration.enabled ? 'error' : undefined);
    } catch (e) { toast((e as Error).message, 'error'); }
    setBusy(false);
  };
  return (
    <div className="space-y-3">
      <p className="text-xs leading-6 text-slate-600">
        قبل كل تصميم: يبحث النظام في <b>Freepik</b> عن المنتج والمناسبة، ويختار <b>{v.count} مراجع متنوعة</b>، فيستخلص المخرج الفني منها <b>المبادئ فقط</b> (التكوين، الألوان، الإضاءة، طريقة عرض المنتج) ثم يبتكر فكرة <b>أصلية</b> تتفوق عليها. المراجع لا تُنسخ ولا تُرسل لمولّد الصور ولا تُخزّن — يُسجَّل رابط كل مرجع وصاحبه ونوع ترخيصه، ويُمنع اعتماد أي تصميم يشبه مرجعًا شبهًا شبه حرفي.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1"><label className="label" htmlFor="fp-key">مفتاح Freepik API</label>
          <input id="fp-key" type="password" autoComplete="off" className="input ltr" placeholder={key.configured ? `محفوظ ••••${key.last4 ?? ''}` : 'FPSX…'} value={newKey} onChange={(e) => setNewKey(e.target.value)} /></div>
        <button type="button" disabled={busy || !newKey.trim()} onClick={() => void save()} className="rounded-lg bg-navy-800 px-3 py-2 text-sm font-bold text-white disabled:opacity-40">حفظ المفتاح</button>
        <button type="button" disabled={busy || !key.configured} onClick={async () => { setBusy(true); try { setTest(await apiCall('/api/settings/inspiration/verify', { method: 'POST' })); } catch (e) { setTest({ ok: false, message: (e as Error).message }); } setBusy(false); }}
          className="rounded-lg border px-3 py-2 text-sm font-bold text-navy-800 disabled:opacity-40">اختبار الاتصال</button>
        {key.configured && <button type="button" disabled={busy} onClick={() => { if (window.confirm('حذف مفتاح Freepik؟ يتوقف البحث.')) void save({ apiKey: '__delete__', enabled: false }); }} className="px-2 py-2 text-xs font-bold text-red-600 underline">حذف</button>}
      </div>
      <p className="text-[11px] text-slate-500">احصل على المفتاح من حسابك في Freepik (قسم API). قد تكون الخدمة مدفوعة أو محدودة حسب خطتك — القرار لك. لا تُرسل المفتاح في المحادثات.</p>
      {test && (
        <div className={`rounded-lg p-2 text-xs ${test.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}>
          <b>{test.message}</b>
          {test.sample && <ul className="mt-1 space-y-0.5">{test.sample.map((s) => <li key={s.url}><a className="underline" href={s.url} target="_blank" rel="noreferrer noopener">{s.title}</a> <span className="text-slate-500">· {s.license === 'premium' ? 'ترخيص مدفوع' : s.license === 'freemium' ? 'مجاني بنسبة' : 'ترخيص غير محدد'}</span></li>)}</ul>}
        </div>
      )}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 accent-navy-800" checked={v.enabled} disabled={busy} onChange={(e) => void save({ enabled: e.target.checked })} />
        <span><b>تفعيل البحث البصري قبل كل تصميم</b> — تحليل المراجع بمكالمة رؤية واحدة صغيرة (≈ $0.003 لكل تصميم). إن تعذّر البحث يُصمَّم الإعلان كالمعتاد ويصلك تنبيه.</span></label>
      <div className="flex flex-wrap items-center gap-4">
        <div><label className="label" htmlFor="fp-count">عدد المراجع: <b>{v.count}</b></label>
          <input id="fp-count" type="range" min={5} max={10} value={v.count} className="w-40 accent-gold-500" onChange={(e) => setV({ ...v, count: Number(e.target.value) })} onMouseUp={() => void save()} onTouchEnd={() => void save()} onKeyUp={() => void save()} /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-navy-800" checked={v.freeOnly} onChange={(e) => void save({ freeOnly: e.target.checked })} /> مراجع مجانية الترخيص فقط</label>
      </div>
    </div>
  );
}
