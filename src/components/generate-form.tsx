'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { apiCall } from '@/lib/client/api';
import { Button } from './ui';
import { CONTENT_TYPES, LANGUAGES, MARKETS, OCCASIONS, SEGMENTS } from '@/lib/creative/options';
import { DesignFields, designDirection, EMPTY_DESIGN, type DesignValues } from './design-fields';

type Opt = { id: string; label: string };
type Idea = { title: string; idea: string };

function Select({ name, label, value, onChange, children, hint }: { name: string; label: string; value: string; onChange: (v: string) => void; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <select id={name} name={name} className="input" value={value} onChange={(e) => onChange(e.target.value)}>{children}</select>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/**
 * "إنشاء إعلان الآن": creative direction (content type, market, language, segment, occasion, idea)
 * → enqueues generation on the worker and polls until the worker reports the result.
 */
export function GenerateForm({ accounts, products, initialIdea = '' }: { accounts: Opt[]; products: Opt[]; initialIdea?: string }) {
  const router = useRouter();
  const [v, setV] = useState({ accountId: accounts[0]?.id ?? '', productId: '', format: '', language: '', contentType: '', market: '', segment: '', occasion: '', idea: initialIdea });
  const set = (k: keyof typeof v) => (val: string) => setV((x) => ({ ...x, [k]: val }));
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [ideasBusy, setIdeasBusy] = useState(false);
  const [design, setDesign] = useState<DesignValues>(EMPTY_DESIGN);

  const direction = () => {
    const d: Record<string, unknown> = {};
    for (const k of ['contentType', 'market', 'segment', 'occasion', 'idea'] as const) if (v[k].trim()) d[k] = v[k].trim();
    Object.assign(d, designDirection(design, v.format));
    return Object.keys(d).length ? d : undefined;
  };
  const common = () => ({ accountId: v.accountId, productId: v.productId || undefined, language: v.language || undefined, direction: direction() });

  return (
    <form className="space-y-5" onSubmit={async (e) => {
      e.preventDefault(); setErr(null); setBusy(true); setStatus('تم إرسال الطلب إلى عامل التوليد…');
      try {
        const { jobId } = await apiCall<{ jobId: string }>('/api/ads/generate', { body: { ...common(), format: v.format || undefined } });
        for (let i = 0; i < 180; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const j = await apiCall<{ state: string; result: { adId: string } | null; failedReason: string | null }>(`/api/jobs/${jobId}`).catch(() => null);
          if (!j) continue;
          if (j.state === 'completed' && j.result) { router.push(`/ads/${j.result.adId}`); return; }
          if (j.state === 'failed') { setErr(j.failedReason ?? 'فشل التوليد'); setBusy(false); setStatus(null); return; }
          setStatus(j.state === 'active' ? 'جارٍ التوليد: الفكرة ← المشهد ← التركيب ← فحص الجودة…' : 'بانتظار عامل التوليد…');
        }
        setErr('انتهت مهلة الانتظار — راجع مكتبة التصاميم لاحقًا.');
      } catch (x) { setErr((x as Error).message); }
      setBusy(false);
    }}>
      <fieldset className="grid gap-4 md:grid-cols-4">
        <legend className="mb-2 text-sm font-extrabold text-navy-800">١. الأساسيات</legend>
        <Select name="accountId" label="الحساب" value={v.accountId} onChange={set('accountId')}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</Select>
        <Select name="productId" label="المنتج" value={v.productId} onChange={set('productId')}><option value="">اختيار تلقائي بالذكاء الاصطناعي</option>{products.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Select>
        <Select name="format" label="الصيغة" value={v.format} onChange={set('format')}>
          <option value="">حسب إعداد الحساب</option><option value="IMAGE_STORY">صورة عمودية 1080×1920</option><option value="IMAGE_FEED">صورة منشور 1080×1350</option><option value="IMAGE_SQUARE">صورة مربعة</option><option value="REEL_VIDEO">فيديو Reel متحرك</option><option value="IMAGE_CAROUSEL">كاروسيل شرائح (للحفظ والمشاركة)</option>
        </Select>
        <Select name="language" label="لغة المحتوى" value={v.language} onChange={set('language')} hint="النصوص وعبارة الحث وأسماء الفروع بهذه اللغة">
          <option value="">حسب لغة الحساب</option>{LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.ar}</option>)}
        </Select>
      </fieldset>

      <fieldset className="grid gap-4 md:grid-cols-4">
        <legend className="mb-2 text-sm font-extrabold text-navy-800">٢. التوجيه الإبداعي <span className="font-normal text-slate-500">(اختياري — اتركه ليختار الذكاء الاصطناعي)</span></legend>
        <Select name="contentType" label="نوع المحتوى" value={v.contentType} onChange={set('contentType')}><option value="">اختيار تلقائي</option>{CONTENT_TYPES.map((o) => <option key={o.value} value={o.value}>{o.ar}</option>)}</Select>
        <Select name="market" label="الجمهور والسوق" value={v.market} onChange={set('market')}><option value="">اختيار تلقائي</option>{MARKETS.map((o) => <option key={o.value} value={o.value}>{o.ar}</option>)}</Select>
        <Select name="segment" label="الفئة المستهدفة" value={v.segment} onChange={set('segment')}><option value="">اختيار تلقائي</option>{SEGMENTS.map((o) => <option key={o.value} value={o.value}>{o.ar}</option>)}</Select>
        <Select name="occasion" label="نوع المناسبة" value={v.occasion} onChange={set('occasion')}><option value="">اختيار تلقائي</option>{OCCASIONS.map((o) => <option key={o.value} value={o.value}>{o.ar}</option>)}</Select>
      </fieldset>

      <DesignFields v={design} set={(patch) => setDesign((x) => ({ ...x, ...patch }))} format={v.format} />

      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-extrabold text-navy-800">٣. فكرة الإعلان</legend>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" disabled={ideasBusy || !v.accountId} onClick={async () => {
            setErr(null); setIdeasBusy(true);
            try { const r = await apiCall<{ ideas: Idea[] }>('/api/ads/suggest-ideas', { body: common() }); setIdeas(r.ideas); }
            catch (x) { setErr((x as Error).message); }
            setIdeasBusy(false);
          }}><Sparkles size={16} />{ideasBusy ? 'جارٍ التفكير…' : 'اقترح أفكارًا رائعة ومميزة'}</Button>
          <span className="text-xs text-slate-500">يقترح 3 أفكار مختلفة تناسب اختياراتك ولم تُستخدم على هذا الحساب مؤخرًا.</span>
        </div>
        {ideas && (
          <div className="grid gap-2 md:grid-cols-3">
            {ideas.map((it, i) => (
              <button type="button" key={i} onClick={() => set('idea')(it.idea)}
                className={`rounded-xl border-2 p-3 text-right text-sm transition ${v.idea === it.idea ? 'border-gold-500 bg-gold-300/20' : 'border-slate-200 hover:border-gold-400'}`}>
                <div className="font-extrabold text-navy-900">{it.title}</div>
                <div className="mt-1 text-xs text-slate-600">{it.idea}</div>
                <div className="mt-2 text-xs font-bold text-gold-600">{v.idea === it.idea ? '✓ مختارة' : 'اختر هذه الفكرة'}</div>
              </button>
            ))}
          </div>
        )}
        <textarea name="idea" rows={3} maxLength={500} className="input" value={v.idea} onChange={(e) => set('idea')(e.target.value)}
          placeholder="اكتب فكرتك الخاصة، أو اختر إحدى الأفكار المقترحة، أو اتركها فارغة ليبتكر الذكاء الاصطناعي فكرة مميزة. مثال: كوب مطبوع بصورة العائلة على طاولة إفطار رمضاني" />
        <p className="text-xs text-amber-700">لا تذكر أسعارًا أو خصومات أو مدد تسليم — يرفضها فحص الجودة تلقائيًا.</p>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="gold" size="lg" disabled={busy || !v.accountId}>{busy ? 'جارٍ الإنشاء…' : 'إنشاء إعلان الآن'}</Button>
        {status && <p className="text-sm text-navy-700">{status}</p>}
      </div>
      {err && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{err}</p>}
    </form>
  );
}
