'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiCall } from '@/lib/client/api';
import { Button } from './ui';

type Ai = { dryRun: boolean; textModel: string; imageModel: string; imageQuality: 'low' | 'medium' | 'high'; monthlyBudgetUsd: number; alertThresholdPct: number; maxDailyAds: number; maxRetries: number; creativeStyle: string; languages: string[]; useAiReview: boolean; aiFullRequiresApproval: boolean; pricing: Record<string, number> };

export function AiSettingsForm({ ai, keyStatus }: { ai: Ai; keyStatus: { configured: boolean; last4: string | null } }) {
  const router = useRouter();
  const [v, setV] = useState(ai);
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const num = (k: keyof Ai) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: Number(e.target.value) });
  return (
    <form className="space-y-5" onSubmit={async (e) => {
      e.preventDefault(); setMsg(null);
      try { await apiCall('/api/settings/ai', { method: 'PUT', body: { ...v, apiKey: key || undefined } }); setKey(''); setMsg({ ok: true, t: 'تم الحفظ ✓' }); router.refresh(); }
      catch (x) { setMsg({ ok: false, t: (x as Error).message }); }
    }}>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2"><label className="label">مفتاح OpenAI API (يُخزّن مشفرًا على الخادم ولا يُعرض مجددًا)</label>
          <input type="password" autoComplete="off" className="input ltr" placeholder={keyStatus.configured ? `مضبوط ••••${keyStatus.last4}` : 'sk-…'} value={key} onChange={(e) => setKey(e.target.value)} /></div>
        <div className="flex items-end gap-2">
          <Button type="button" variant="outline" onClick={async () => { try { const r = await apiCall<{ ok: boolean; message: string }>('/api/settings/ai/verify', { method: 'POST' }); setMsg({ ok: r.ok, t: r.message }); } catch (x) { setMsg({ ok: false, t: (x as Error).message }); } }}>التحقق من المفتاح</Button>
          {keyStatus.configured && <Button type="button" variant="ghost" onClick={async () => { if (confirm('حذف المفتاح؟')) { await apiCall('/api/settings/ai', { method: 'PUT', body: { ...v, apiKey: '__delete__' } }); router.refresh(); } }}>حذف</Button>}
        </div>
        <label className="flex items-center gap-2 rounded-lg border p-3 text-sm md:col-span-3"><input type="checkbox" checked={v.dryRun} onChange={(e) => setV({ ...v, dryRun: e.target.checked })} /><b>وضع التجربة (Dry-run)</b> — بدون استدعاء OpenAI وبدون تكلفة. المخرجات معاينات غير قابلة للنشر.</label>
        <label className="flex items-start gap-2 rounded-lg border p-3 text-sm md:col-span-3"><input type="checkbox" className="mt-1" checked={v.aiFullRequiresApproval} onChange={(e) => setV({ ...v, aiFullRequiresApproval: e.target.checked })} /><span><b>طلب موافقتي على «التصميم الكامل بالذكاء الاصطناعي» قبل النشر</b> — النص في هذه التصاميم يرسمه النموذج وقد يحتوي أخطاء إملائية. عند إلغاء هذا الخيار تُنشر تلقائيًا في الوضع الذاتي (الشعار والأرقام وزر الطلب تبقى مضمونة لأن النظام يضيفها).</span></label>
        <div><label className="label">نموذج النص</label><input className="input ltr" value={v.textModel} onChange={(e) => setV({ ...v, textModel: e.target.value })} /></div>
        <div><label className="label">نموذج الصور</label><input className="input ltr" value={v.imageModel} onChange={(e) => setV({ ...v, imageModel: e.target.value })} /></div>
        <div><label className="label">جودة الصور</label><select className="input" value={v.imageQuality} onChange={(e) => setV({ ...v, imageQuality: e.target.value as Ai['imageQuality'] })}><option value="low">منخفضة</option><option value="medium">متوسطة</option><option value="high">عالية</option></select></div>
        <div><label className="label">حد الإنفاق الشهري (USD)</label><input type="number" min={0} step="0.5" className="input" value={v.monthlyBudgetUsd} onChange={num('monthlyBudgetUsd')} /></div>
        <div><label className="label">تنبيه عند نسبة (%)</label><input type="number" min={1} max={100} className="input" value={v.alertThresholdPct} onChange={num('alertThresholdPct')} /></div>
        <div><label className="label">الحد الأقصى اليومي للإعلانات</label><input type="number" min={0} className="input" value={v.maxDailyAds} onChange={num('maxDailyAds')} /></div>
        <div><label className="label">أقصى إعادة محاولة لكل طلب</label><input type="number" min={0} max={5} className="input" value={v.maxRetries} onChange={num('maxRetries')} /></div>
        <div className="md:col-span-2"><label className="label">اللغات المفعّلة</label><div className="flex gap-4 pt-2 text-sm">{[['ar', 'العربية'], ['en', 'English'], ['ml', 'Malayalam']].map(([k, l]) => <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={v.languages.includes(k)} onChange={(e) => setV({ ...v, languages: e.target.checked ? [...v.languages, k] : v.languages.filter((x) => x !== k) })} />{l}</label>)}</div></div>
        <div className="md:col-span-3"><label className="label">الأسلوب الإبداعي</label><textarea rows={3} className="input ltr" value={v.creativeStyle} onChange={(e) => setV({ ...v, creativeStyle: e.target.value })} /></div>
        <fieldset className="grid gap-2 rounded-lg border p-3 md:col-span-3 md:grid-cols-5">
          <legend className="px-1 text-xs font-bold text-slate-500">أسعار تقديرية للتتبع (USD) — حدّثها وفق تسعير OpenAI الحالي</legend>
          {Object.entries(v.pricing).map(([k, val]) => <div key={k}><label className="text-xs ltr">{k}</label><input type="number" step="0.001" min={0} className="input" value={val} onChange={(e) => setV({ ...v, pricing: { ...v.pricing, [k]: Number(e.target.value) } })} /></div>)}
        </fieldset>
      </div>
      <div className="flex items-center gap-3"><Button>حفظ الإعدادات</Button>{msg && <span className={msg.ok ? 'text-sm text-emerald-700' : 'rounded bg-red-50 p-2 text-sm text-red-700'}>{msg.t}</span>}</div>
    </form>
  );
}
