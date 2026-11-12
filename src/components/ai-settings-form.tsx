'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiCall } from '@/lib/client/api';
import { Button } from './ui';

type Ai = { dryRun: boolean; textModel: string; imageModel: string; imageQuality: 'low' | 'medium' | 'high'; monthlyBudgetUsd: number; alertThresholdPct: number; maxDailyAds: number; maxRetries: number; creativeStyle: string; languages: string[]; useAiReview: boolean; aiFullRequiresApproval: boolean; autoRenderMode?: string; autoDesignStyle?: string; creativeConcepts?: boolean; bestOf?: number; pricing: Record<string, number>; qualityByFormat: Record<string, '' | 'low' | 'medium' | 'high'> };
const FORMATS: [string, string][] = [['IMAGE_STORY', 'ستوري 1080×1920'], ['IMAGE_FEED', 'منشور 1080×1350'], ['IMAGE_SQUARE', 'مربع'], ['IMAGE_CAROUSEL', 'كاروسيل'], ['REEL_VIDEO', 'ريلز']];

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
        <div className="grid gap-3 rounded-lg border p-3 md:col-span-3 md:grid-cols-2">
          <div className="md:col-span-2 text-sm font-extrabold text-navy-800">تصاميم النشر الآلي (الجدولة، الحملات، n8n)</div>
          <div><label className="label">طريقة التصميم</label><select className="input" value={v.autoRenderMode ?? 'auto'} onChange={(e) => setV({ ...v, autoRenderMode: e.target.value })}>
            <option value="auto">تلقائي (موصى به) — ملصق كامل احترافي للستوري والريلز في حسابات الموافقة، ونص مضمون للحسابات الذاتية</option>
            <option value="ai_full">ملصق كامل بالذكاء الاصطناعي دائمًا (يحتاج موافقتك)</option>
            <option value="layered">قالب بطبقات ونص مضمون 100% دائمًا</option></select></div>
          <div><label className="label">أسلوب التصميم</label><select className="input" value={v.autoDesignStyle ?? 'fc_signature'} onChange={(e) => setV({ ...v, autoDesignStyle: e.target.value })}>
            <option value="fc_signature">توقيع المطبعة الإعلاني (من نماذجك) — ألوان الخلفية تتغير حسب المناسبة والجمهور والمنتج</option>
            <option value="auto">تلقائي — يتنوع بين كل الأساليب</option></select></div>
        </div>
        <label className="flex items-start gap-2 rounded-lg border p-3 text-sm md:col-span-3"><input type="checkbox" className="mt-1" checked={v.aiFullRequiresApproval} onChange={(e) => setV({ ...v, aiFullRequiresApproval: e.target.checked })} /><span><b>طلب موافقتي على «التصميم الكامل بالذكاء الاصطناعي» قبل النشر</b> — النص في هذه التصاميم يرسمه النموذج وقد يحتوي أخطاء إملائية. عند إلغاء هذا الخيار تُنشر تلقائيًا في الوضع الذاتي (الشعار والأرقام وزر الطلب تبقى مضمونة لأن النظام يضيفها).</span></label>
        <div><label className="label">نموذج النص</label><input className="input ltr" value={v.textModel} onChange={(e) => setV({ ...v, textModel: e.target.value })} /></div>
        <div><label className="label">نموذج الصور</label><input className="input ltr" value={v.imageModel} onChange={(e) => setV({ ...v, imageModel: e.target.value })} /></div>
        <div><label className="label">جودة الصور</label><select className="input" value={v.imageQuality} onChange={(e) => setV({ ...v, imageQuality: e.target.value as Ai['imageQuality'] })}><option value="low">منخفضة</option><option value="medium">متوسطة</option><option value="high">عالية</option></select></div>
        <fieldset className="rounded-lg border-2 border-gold-300 p-3 md:col-span-3">
          <legend className="px-1 text-sm font-bold text-navy-800">✨ استوديو الإبداع</legend>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={v.creativeConcepts ?? true} onChange={(e) => setV({ ...v, creativeConcepts: e.target.checked })} /><span><b>فكرة بصرية مميزة لكل تصميم</b> — 10 أفكار إبداعية تتناوب لكل حساب: طبيعة صامتة فاخرة، المنتج يطفو، لحظة حركة مجمّدة، عالم مصغّر، ورق مقصوص، لون جريء وأشكال هندسية، تراث خليجي فاخر، لقطة سينمائية، مجسّمات ناعمة، مفاجأة الحجم. حسابات الشركات تأخذ الأفكار الرسمية فقط.</span></label>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div><label className="label">المخرج الفني: عدد الصور المولدة لكل تصميم</label>
              <select className="input" style={{ width: '16rem' }} value={v.bestOf ?? 1} onChange={(e) => setV({ ...v, bestOf: Number(e.target.value) })}>
                <option value={1}>صورة واحدة (الأوفر)</option><option value={2}>صورتان ويُختار الأفضل (موصى به)</option><option value={3}>3 صور ويُختار الأفضل</option>
              </select></div>
            <p className="text-xs text-slate-500">يقيّم الذكاء الاصطناعي كل صورة كمخرج فني (دقة شكل المنتج، الجمال، قوة التكوين، خلوها من الحروف) ويحتفظ بالأقوى. كل صورة إضافية = تكلفة صورة.</p>
          </div>
          <button type="button" className="mt-3 rounded-lg bg-navy-800 px-3 py-1.5 text-xs font-bold text-white" onClick={() => setV({ ...v, creativeConcepts: true, bestOf: 2, qualityByFormat: { IMAGE_STORY: 'medium', IMAGE_FEED: 'high', IMAGE_SQUARE: 'high', IMAGE_CAROUSEL: 'high', REEL_VIDEO: 'high' } })}>⭐ تطبيق «الجودة الاحترافية»: عالية للريلز والمنشورات والكاروسيل · متوسطة للستوري · صورتان ويُختار الأفضل</button>
          <p className="mt-1 text-xs text-slate-500">ثم اضغط «حفظ الإعدادات». راجع الحد الشهري للإنفاق أدناه — التكلفة لكل تصميم تزيد تقريبًا 2–4 أضعاف.</p>
        </fieldset>
        <fieldset className="rounded-lg border p-3 md:col-span-3">
          <legend className="px-1 text-sm font-bold text-navy-800">الجودة حسب الصيغة</legend>
          <p className="mb-2 text-xs text-slate-500">الذكاء الاصطناعي يرسم صورة المنتج فقط — الشعار والنصوص والأرقام يضيفها النظام بنفس الدقة في كل المستويات. «حسب الإعداد العام» = جودة الصور أعلاه.</p>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-5">
            {FORMATS.map(([f, label]) => {
              const q = (v.qualityByFormat?.[f] || v.imageQuality) as 'low' | 'medium' | 'high';
              const price = q === 'low' ? v.pricing.imageLow : q === 'high' ? v.pricing.imageHigh : v.pricing.imageMedium;
              return (
                <div key={f}><label className="label">{label}</label>
                  <select className="input" value={v.qualityByFormat?.[f] ?? ''} onChange={(e) => setV({ ...v, qualityByFormat: { ...v.qualityByFormat, [f]: e.target.value as Ai['qualityByFormat'][string] } })}>
                    <option value="">حسب الإعداد العام</option><option value="low">منخفضة</option><option value="medium">متوسطة</option><option value="high">عالية</option>
                  </select>
                  <p className="mt-1 text-xs text-slate-500 ltr">≈ ${(price + 0.002).toFixed(3)} / design</p></div>
              );
            })}
          </div>
          <button type="button" className="mt-2 text-xs font-bold text-gold-600 underline" onClick={() => setV({ ...v, qualityByFormat: { IMAGE_STORY: 'low', IMAGE_FEED: 'medium', IMAGE_SQUARE: 'medium', IMAGE_CAROUSEL: 'medium', REEL_VIDEO: 'medium' } })}>تطبيق الموصى به (ستوري منخفضة · الباقي متوسطة)</button>
        </fieldset>
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
