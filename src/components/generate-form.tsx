'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarHeart, Check, ChevronLeft, ChevronRight, Clock, ImageIcon, Search, Sparkles, Wand2 } from 'lucide-react';
import { apiCall } from '@/lib/client/api';
import { Button, cn } from './ui';
import { CONCEPTS, CONTENT_TYPES, DESIGN_STYLES, IDEA_ANGLES, LANGUAGES, MARKETS, OCCASIONS, SEGMENTS } from '@/lib/creative/options';
import { ideaGuard } from '@/lib/creative/idea-guard';
import { DesignFields, designDirection, EMPTY_DESIGN, type DesignValues } from './design-fields';

type Opt = { id: string; label: string };
export type ProductOpt = { id: string; label: string; category: string; photoKey: string | null };
export type UpcomingOpt = { value: string; ar: string; days: number };
type Idea = { title: string; idea: string; hook?: string | null; angle?: string | null; format?: string | null; score?: number | null; productId?: string; status?: string };

const FORMATS = [
  { value: '', title: 'حسب الحساب', hint: 'مزيج النمو أو صيغة الحساب', ratio: '', frame: 'aspect-[4/5]' },
  { value: 'REEL_VIDEO', title: 'ريلز', hint: 'أعلى وصول لغير المتابعين', ratio: '9:16', frame: 'aspect-[9/16]', badge: 'الأقوى' },
  { value: 'IMAGE_CAROUSEL', title: 'كاروسيل', hint: 'نصائح ومقارنات — يُحفظ ويُشارك', ratio: '4:5', frame: 'aspect-[4/5]' },
  { value: 'IMAGE_FEED', title: 'منشور', hint: 'صورة واحدة قوية', ratio: '4:5', frame: 'aspect-[4/5]' },
  { value: 'IMAGE_STORY', title: 'ستوري', hint: 'تذكير سريع 24 ساعة', ratio: '9:16', frame: 'aspect-[9/16]' },
  { value: 'IMAGE_SQUARE', title: 'مربع', hint: '1080×1080', ratio: '1:1', frame: 'aspect-square' },
] as const;
const STEPS = ['الحساب والمنتج', 'الفكرة', 'التصميم', 'المراجعة والإنشاء'];
// what the worker does, in order, with the usual share of the time (shown as an estimate, never as a fake live status)
const PHASES = [{ t: 'كتابة الفكرة والنص', at: 0 }, { t: 'توليد الصورة', at: 12 }, { t: 'التركيب بالشعار والأرقام', at: 55 }, { t: 'فحص الجودة', at: 70 }];
const FORMAT_AR: Record<string, string> = { REEL_VIDEO: 'ريلز', IMAGE_CAROUSEL: 'كاروسيل', IMAGE_FEED: 'منشور', IMAGE_STORY: 'ستوري', IMAGE_SQUARE: 'مربع' };
const PAGE = 11; // two rows on desktop (6 per row with «تلقائي»), four short rows on a phone

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <div><label className="label">{label}</label>{children}{hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}</div>;
}

/**
 * «إنشاء تصميم جديد» — a 4-step flow in the order a designer works:
 * 1) account, product, format  2) the idea (bank / suggestions / own)  3) design method & style  4) review → create.
 * Every choice has an «تلقائي» default, so «إنشاء» works from any step. A live «بطاقة الطلب» beside the steps shows
 * the format frame, the product photo, the idea and the estimated cost as the order takes shape.
 */
export function GenerateForm({ accounts, products, initialIdea = '', costs = {}, upcoming = [], dryRun = false, blocked = false }: {
  accounts: Opt[]; products: ProductOpt[]; initialIdea?: string; costs?: Record<string, number>; upcoming?: UpcomingOpt[]; dryRun?: boolean; blocked?: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState(initialIdea ? 1 : 0);
  const [v, setV] = useState({ accountId: accounts[0]?.id ?? '', productId: '', format: '', language: '', contentType: '', market: '', segment: '', occasion: '', idea: initialIdea });
  const set = (k: keyof typeof v) => (val: string) => setV((x) => ({ ...x, [k]: val }));
  const [pq, setPq] = useState('');
  const [cat, setCat] = useState('');
  const [more, setMore] = useState(PAGE);
  const [design, setDesign] = useState<DesignValues>({ ...EMPTY_DESIGN, renderMode: 'auto' }); // everything automatic by default
  const [bank, setBank] = useState<Idea[]>([]);
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [ideasBusy, setIdeasBusy] = useState(false);
  const [ideasNote, setIdeasNote] = useState<{ kind: 'warn' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    if (!v.accountId) return;
    apiCall<Idea[]>(`/api/ideas?accountId=${encodeURIComponent(v.accountId)}`).then(setBank).catch(() => setBank([]));
  }, [v.accountId]);
  useEffect(() => { if (!busy) return; const t = setInterval(() => setElapsed((e) => e + 1), 1000); return () => clearInterval(t); }, [busy]);

  const cats = useMemo(() => [...new Set(products.map((p) => p.category))].filter(Boolean), [products]);
  const filtered = useMemo(() => { const q = pq.trim(); return products.filter((p) => (!cat || p.category === cat) && (!q || p.label.includes(q) || p.category.includes(q))); }, [pq, cat, products]);
  const product = products.find((p) => p.id === v.productId) ?? null;
  const productLabel = product?.label ?? 'تلقائي (يختاره النظام)';
  const accountLabel = accounts.find((a) => a.id === v.accountId)?.label ?? '—';
  const fmt = FORMATS.find((f) => f.value === v.format) ?? FORMATS[0];
  const cost = dryRun ? 0 : costs[v.format || 'default'] ?? costs.default ?? 0;
  const guard = ideaGuard(v.idea);
  const occasionAr = OCCASIONS.find((o) => o.value === v.occasion)?.ar;

  const direction = () => {
    const d: Record<string, unknown> = {};
    for (const k of ['contentType', 'market', 'segment', 'occasion', 'idea'] as const) if (v[k].trim()) d[k] = v[k].trim();
    Object.assign(d, designDirection(design, v.format));
    return Object.keys(d).length ? d : undefined;
  };
  const common = () => ({ accountId: v.accountId, productId: v.productId || undefined, language: v.language || undefined, direction: direction() });
  const pickIdea = (it: Idea) => setV((x) => ({ ...x, idea: [it.title, it.idea, it.hook ? `الافتتاحية: ${it.hook}` : ''].filter(Boolean).join(' — ').slice(0, 500), ...(it.productId ? { productId: it.productId } : {}), ...(it.format && !x.format ? { format: it.format } : {}) }));
  const canCreate = !!v.accountId && !blocked;

  const create = async () => {
    setErr(null); setBusy(true); setElapsed(0); setStuck(false);
    try {
      const { jobId } = await apiCall<{ jobId: string }>('/api/ads/generate', { body: { ...common(), format: v.format || undefined } });
      for (let i = 0; i < 180; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const j = await apiCall<{ state: string; result: { adId: string } | null; failedReason: string | null }>(`/api/jobs/${jobId}`).catch(() => null);
        if (!j) continue;
        // still queued after ~40 s → the background worker is not taking jobs (stopped/crashed) — say so instead of spinning
        setStuck(i >= 20 && (j.state === 'waiting' || j.state === 'delayed' || j.state === 'prioritized'));
        if (j.state === 'completed' && j.result) { router.push(`/ads/${j.result.adId}`); return; }
        if (j.state === 'failed') { setErr(j.failedReason ?? 'فشل التوليد'); setBusy(false); return; }
      }
      setErr('انتهت مهلة الانتظار — ستجد التصميم في مكتبة التصاميم أو طابور الموافقات عند انتهائه.');
    } catch (x) { setErr((x as Error).message); }
    setBusy(false);
  };

  if (busy) {
    // honest progress: the worker reports done/failed, not the phase — the phases are the usual plan, marked «تقديري»
    const usual = v.format === 'REEL_VIDEO' ? 180 : 90;
    const pct = Math.min(95, Math.round((elapsed / usual) * 100));
    const cur = PHASES.reduce((a, p, i) => (pct >= p.at ? i : a), 0);
    return (
      <div className="mx-auto max-w-lg py-6 text-center">
        <div className={`${fmt.frame} relative mx-auto mb-5 w-32 overflow-hidden rounded-xl bg-gradient-to-b from-navy-800 to-navy-950 shadow-lg ring-2 ring-gold-400`}>
          {product?.photoKey && <img src={`/api/media/${product.photoKey}`} alt="" className="h-full w-full object-cover opacity-60" />}
          <span className="absolute inset-0 animate-pulse bg-gradient-to-t from-gold-400/30 to-transparent" aria-hidden />
          <Sparkles className="absolute inset-0 m-auto text-gold-300" size={28} aria-hidden />
        </div>
        <div className="text-lg font-extrabold text-navy-900">جارٍ إنشاء التصميم…</div>
        <p className="mt-1 text-sm text-slate-500"><Clock size={14} className="inline" /> {elapsed} ثانية · عادة {v.format === 'REEL_VIDEO' ? '2–4 دقائق' : '30–90 ثانية'}</p>
        <div className="mx-auto mt-4 h-2 max-w-xs overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="التقدم التقديري">
          <div className="h-full rounded-full bg-gradient-to-l from-gold-400 to-gold-600 transition-all duration-1000" style={{ width: `${pct}%` }} />
        </div>
        <ol className="mx-auto mt-5 max-w-xs space-y-2 text-right text-sm">{PHASES.map((p, i) => (
          <li key={p.t} className={cn('flex items-center gap-2', i < cur ? 'text-emerald-700' : i === cur ? 'font-bold text-navy-900' : 'text-slate-400')}>
            <span className={cn('flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold', i < cur ? 'bg-emerald-100' : i === cur ? 'bg-gold-300/50' : 'bg-slate-100')}>{i < cur ? <Check size={12} /> : i + 1}</span>{p.t}</li>))}</ol>
        <p className="mt-2 text-[11px] text-slate-400">المراحل تقديرية حسب الوقت المعتاد.</p>
        {stuck && <p role="alert" className="mx-auto mt-4 max-w-md rounded-lg bg-amber-50 p-3 text-sm text-amber-800">الطلب ما زال في الانتظار ولم يبدأ — غالبًا العامل الخلفي (worker) متوقف. افتح <a className="font-bold underline" href="/diagnostics">تشخيص النظام</a>، أو أعد التشغيل على السيرفر: <code dir="ltr">bash scripts/update.sh</code></p>}
        <p className="mt-4 text-xs text-slate-500">يمكنك مغادرة الصفحة — سيظهر التصميم في طابور الموافقات عند انتهائه.</p>
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0">
        <ol className="mb-6 grid grid-cols-4 gap-1">
          {STEPS.map((t, i) => (
            <li key={t} className="relative">
              {i > 0 && <span aria-hidden className={cn('absolute right-[calc(-50%+22px)] top-[17px] h-0.5 w-[calc(100%-44px)]', i <= step ? 'bg-gold-400' : 'bg-slate-200')} />}
              <button type="button" onClick={() => setStep(i)} className="relative flex w-full flex-col items-center gap-1 text-center" aria-current={i === step ? 'step' : undefined}>
                <span className={cn('flex h-9 w-9 items-center justify-center rounded-full text-sm font-extrabold transition', i < step ? 'bg-emerald-600 text-white' : i === step ? 'bg-navy-800 text-white ring-4 ring-gold-300' : 'bg-slate-100 text-slate-500')}>{i < step ? <Check size={16} /> : i + 1}</span>
                <span className={cn('text-[11px] font-bold leading-tight sm:text-xs', i === step ? 'text-navy-900' : 'text-slate-500')}>{t}</span>
              </button>
            </li>
          ))}
        </ol>

        {step === 0 && (
          <div className="space-y-5">
            <Field label="الحساب"><select className="input" value={v.accountId} onChange={(e) => set('accountId')(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></Field>
            <div>
              <div className="label">المنتج <span className="font-normal text-slate-500">({products.length})</span></div>
              <div className="relative mb-2"><Search size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input className="input pr-9" value={pq} onChange={(e) => { setPq(e.target.value); setMore(PAGE); }} placeholder="ابحث عن منتج: أكواب، ملصقات، بنر…" aria-label="بحث عن منتج" /></div>
              {cats.length > 1 && <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
                {['', ...cats].map((c) => <button key={c || 'all'} type="button" onClick={() => { setCat(c); setMore(PAGE); }} className={cn('shrink-0 rounded-full border px-3 py-1 text-xs font-bold transition', cat === c ? 'border-navy-800 bg-navy-800 text-white' : 'border-slate-200 text-slate-600 hover:border-gold-400')}>{c || 'الكل'}</button>)}
              </div>}
              <div role="radiogroup" aria-label="المنتج" className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-6">
                <ProductTile selected={!v.productId} onPick={() => set('productId')('')} title="تلقائي" sub="يختار منتجًا مناسبًا لم يُستخدم مؤخرًا" auto />
                {filtered.slice(0, more).map((p) => <ProductTile key={p.id} selected={v.productId === p.id} onPick={() => set('productId')(p.id)} title={p.label} sub={p.category} photo={p.photoKey} />)}
              </div>
              {filtered.length > more && <button type="button" className="mt-2 text-xs font-bold text-navy-700 underline" onClick={() => setMore(more + PAGE * 2)}>عرض المزيد ({filtered.length - more})</button>}
              {!filtered.length && <p className="mt-2 text-xs text-slate-500">لا نتائج — جرّب كلمة أخرى.</p>}
              {product && !product.photoKey && <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700"><AlertTriangle size={14} />لا توجد صورة حقيقية لهذا المنتج — ارفعها من «المنتجات والخدمات» ليُرسم كما هو تمامًا.</p>}
            </div>
            <div><div className="label">الصيغة</div>
              <div role="radiogroup" aria-label="الصيغة" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {FORMATS.map((f) => (
                  <button key={f.value} type="button" role="radio" aria-checked={v.format === f.value} onClick={() => set('format')(f.value)} className={cn('relative flex items-center gap-3 rounded-xl border-2 p-3 text-right transition', v.format === f.value ? 'border-gold-500 bg-gold-300/20' : 'border-slate-200 hover:border-gold-300')}>
                    {'badge' in f && <span className="absolute left-2 top-2 rounded-full bg-emerald-600 px-2 text-[10px] font-bold text-white">{f.badge}</span>}
                    <span className="flex h-12 w-10 shrink-0 items-center justify-center"><span style={{ height: 44, width: Math.round(44 * ({ '9:16': 9 / 16, '4:5': 4 / 5, '1:1': 1 } as Record<string, number>)[f.ratio || '4:5']) }} className={`rounded-[4px] border-2 ${v.format === f.value ? 'border-gold-500 bg-gold-300/40' : 'border-navy-800/40 bg-slate-50'}`} /></span>
                    <span className="min-w-0"><span className="block font-extrabold text-navy-900">{f.title} {f.ratio && <span className="text-[11px] font-normal text-slate-500">{f.ratio}</span>}</span>
                      <span className="block text-xs text-slate-500">{f.hint}</span>
                      {!dryRun && costs[f.value || 'default'] !== undefined && <span className="ltr mt-0.5 block text-right text-[10px] text-slate-400">≈ ${costs[f.value || 'default'].toFixed(3)}</span>}</span>
                  </button>
                ))}
              </div></div>
            <Field label="لغة المحتوى"><select className="input" value={v.language} onChange={(e) => set('language')(e.target.value)}><option value="">حسب لغة الحساب</option>{LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.ar}</option>)}</select></Field>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            {upcoming.length > 0 && (
              <div><div className="label !flex items-center gap-1.5"><CalendarHeart size={16} className="text-gold-600" />مناسبات قريبة</div>
                <div className="flex flex-wrap gap-2">{upcoming.map((o) => (
                  <button key={o.value} type="button" aria-pressed={v.occasion === o.value} onClick={() => set('occasion')(v.occasion === o.value ? '' : o.value)}
                    className={cn('rounded-full border px-3 py-1.5 text-xs font-bold transition', v.occasion === o.value ? 'border-gold-500 bg-gold-300/30 text-navy-900' : 'border-slate-200 text-slate-600 hover:border-gold-400')}>
                    {o.ar} <span className="font-normal text-slate-500">· {o.days <= 0 ? 'الآن' : `بعد ${o.days} يومًا`}</span></button>))}</div></div>
            )}
            {bank.length > 0 && (
              <div><div className="label">💡 من بنك الأفكار لهذا الحساب</div>
                <div className="grid gap-2 md:grid-cols-2">{bank.map((it) => <IdeaCard key={it.title + it.idea} it={it} selected={!!v.idea && v.idea.startsWith(it.title)} onPick={() => pickIdea(it)} />)}</div></div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" disabled={ideasBusy || !v.accountId} onClick={async () => {
                setIdeasNote(null); setIdeasBusy(true);
                try {
                  const r = await apiCall<{ ideas: Idea[]; warning?: string }>('/api/ads/suggest-ideas', { body: common() });
                  setIdeas(r.ideas);
                  if (r.warning) setIdeasNote({ kind: 'warn', text: r.warning });
                  else if (!r.ideas.length) setIdeasNote({ kind: 'warn', text: 'لم تصل أفكار هذه المرة — جرّب مرة أخرى أو اكتب فكرتك.' });
                } catch (x) { setIdeasNote({ kind: 'error', text: (x as Error).message || 'تعذّر جلب الأفكار' }); }
                setIdeasBusy(false);
              }}><Sparkles size={16} />{ideasBusy ? 'جارٍ التفكير…' : 'اقترح 3 أفكار جديدة'}</Button>
              <span className="text-xs text-slate-500">تراعي ذوقك وأسباب رفضك السابقة{occasionAr ? ` والمناسبة (${occasionAr})` : ''}، ولا تكرر أفكار آخر 30 يومًا.</span>
            </div>
            {ideasBusy && <div className="grid gap-2 md:grid-cols-3" role="status" aria-label="يفكّر المخرج الإبداعي">{[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-slate-100" />)}</div>}
            {ideasNote && <p role="alert" className={`rounded-lg p-2 text-sm ${ideasNote.kind === 'error' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}>{ideasNote.text}</p>}
            {ideas && !ideasBusy && <div className="grid gap-2 md:grid-cols-3">{ideas.map((it, i) => <IdeaCard key={i} it={it} selected={!!v.idea && v.idea.startsWith(it.title)} onPick={() => pickIdea(it)} />)}</div>}
            <div>
              <label className="label" htmlFor="gf-idea">الفكرة</label>
              <textarea id="gf-idea" rows={3} maxLength={500} className={cn('input', guard.length && 'border-amber-400')} value={v.idea} onChange={(e) => set('idea')(e.target.value)} placeholder="مثال: كوب مطبوع بصورة العائلة على طاولة إفطار رمضاني" />
              <div className="mt-1 flex justify-between gap-2 text-xs text-slate-500"><span>اكتب فكرتك، أو اختر فكرة أعلاه، أو اتركها فارغة ليبتكر المخرج الإبداعي فكرة.</span><span className="ltr shrink-0">{v.idea.length}/500</span></div>
              {guard.map((g) => <p key={g} role="alert" className="mt-1 flex items-center gap-1.5 text-xs font-bold text-amber-700"><AlertTriangle size={14} />{g}</p>)}
            </div>
            <details className="rounded-xl border p-3" open={!!(v.contentType || v.market || v.segment || (v.occasion && !upcoming.some((o) => o.value === v.occasion)))}>
              <summary className="cursor-pointer text-sm font-bold text-navy-800">توجيه إضافي (اختياري): نوع المحتوى · الجمهور · الفئة · المناسبة</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="نوع المحتوى"><select className="input" value={v.contentType} onChange={(e) => set('contentType')(e.target.value)}><option value="">تلقائي</option>{CONTENT_TYPES.map((o) => <option key={o.value} value={o.value}>{o.ar}</option>)}</select></Field>
                <Field label="الجمهور والسوق"><select className="input" value={v.market} onChange={(e) => set('market')(e.target.value)}><option value="">تلقائي</option>{MARKETS.map((o) => <option key={o.value} value={o.value}>{o.ar}</option>)}</select></Field>
                <Field label="الفئة المستهدفة"><select className="input" value={v.segment} onChange={(e) => set('segment')(e.target.value)}><option value="">تلقائي</option>{SEGMENTS.map((o) => <option key={o.value} value={o.value}>{o.ar}</option>)}</select></Field>
                <Field label="المناسبة"><select className="input" value={v.occasion} onChange={(e) => set('occasion')(e.target.value)}><option value="">تلقائي</option>{OCCASIONS.map((o) => <option key={o.value} value={o.value}>{o.ar}</option>)}</select></Field>
              </div>
            </details>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">كل الخيارات <b>تلقائية افتراضيًا</b> — النظام يختار الطريقة والأسلوب والفكرة البصرية ويتعلم من ذوقك. غيّر فقط ما تريد التحكم به.</p>
            <DesignFields v={design} set={(patch) => setDesign((x) => ({ ...x, ...patch }))} format={v.format} />
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <div className="text-sm font-extrabold text-navy-800">راجع طلبك</div>
            <dl className="divide-y rounded-xl border text-sm">
              {([
                ['الحساب', accountLabel, 0], ['المنتج', productLabel, 0], ['الصيغة', FORMAT_AR[v.format] ?? 'حسب إعداد الحساب', 0],
                ['الفكرة', v.idea.trim() || 'يبتكرها المخرج الإبداعي', 1], ['المناسبة', occasionAr ?? 'تلقائي', 1],
                ['طريقة التصميم', design.renderMode === 'hybrid' ? 'هجين: تصميم ذكي + نص مضمون من النظام' : design.renderMode === 'ai_full' ? 'تصميم كامل بالذكاء الاصطناعي (مع تصحيح الإملاء)' : design.renderMode === 'layered' ? 'طبقات النظام (نص مضمون 100%)' : 'تلقائي (موصى به)', 2],
                ['الأسلوب', DESIGN_STYLES.find((x) => x.value === design.designStyle)?.ar ?? 'تلقائي', 2],
                ['الفكرة البصرية', design.concept === 'none' ? 'بدون' : CONCEPTS.find((x) => x.value === design.concept)?.ar ?? 'تلقائي (تتناوب)', 2],
              ] as const).map(([k, val, s]) => (
                <div key={k} className="flex items-start justify-between gap-3 p-3"><dt className="w-24 shrink-0 text-slate-500">{k}</dt><dd className="min-w-0 flex-1 font-bold text-navy-900" dir="auto">{val}</dd>
                  <button type="button" className="shrink-0 text-xs font-bold text-gold-600 underline" onClick={() => setStep(s)}>تعديل</button></div>
              ))}
            </dl>
            {guard.length > 0 && <p role="alert" className="flex items-center gap-1.5 rounded-lg bg-amber-50 p-2 text-xs font-bold text-amber-800"><AlertTriangle size={14} />{guard[0]} — عدّل الفكرة قبل الإنشاء.</p>}
            <p className="text-xs text-slate-500">بعد الإنشاء: فحص جودة آلي، ثم يصل لطابور الموافقات (أو يُنشر حسب التفويض الذاتي للحساب). لا يُنشر شيء خارجيًا دون اعتماد.</p>
          </div>
        )}

        {err && <p role="alert" className="mt-4 rounded bg-red-50 p-2 text-sm text-red-700">{err}</p>}
        <div className="mt-6 flex items-center justify-between gap-2 border-t pt-4">
          {step > 0 ? <Button type="button" variant="outline" onClick={() => setStep(step - 1)}><ChevronRight size={16} /> السابق</Button> : <span />}
          <div className="flex flex-wrap justify-end gap-2">
            {step < 3 && <Button type="button" variant="outline" onClick={create} disabled={!canCreate} title="باقي الاختيارات تلقائية">إنشاء الآن</Button>}
            {step < 3 ? <Button type="button" onClick={() => setStep(step + 1)} disabled={!v.accountId}>التالي <ChevronLeft size={16} /></Button>
              : <Button type="button" variant="gold" size="lg" onClick={create} disabled={!canCreate}><Sparkles size={18} /> إنشاء التصميم</Button>}
          </div>
        </div>
      </div>

      {/* the order card: what will be made, as it takes shape */}
      <aside className="order-first mx-auto w-full max-w-sm lg:order-none lg:sticky lg:top-4 lg:max-w-none lg:self-start" aria-label="بطاقة الطلب">
        <div className="overflow-hidden rounded-2xl border border-gold-400/60 bg-white shadow-sm">
          <div className="flex items-center justify-between bg-navy-900 px-3 py-2 text-white">
            <span className="flex items-center gap-1.5 text-xs font-bold"><Wand2 size={14} className="text-gold-400" />بطاقة الطلب</span>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-bold">{fmt.ratio || 'حسب الحساب'}</span>
          </div>
          <div className="flex gap-3 p-3 lg:block">
            <div className={`${fmt.frame} relative w-24 shrink-0 overflow-hidden rounded-xl bg-gradient-to-b from-navy-800 to-navy-950 lg:mx-auto lg:w-full lg:max-w-[210px]`}>
              {product?.photoKey ? <img src={`/api/media/${product.photoKey}`} alt={product.label} className="h-full w-full object-cover" />
                : <span className="flex h-full flex-col items-center justify-center gap-1 p-2 text-center text-[10px] text-navy-100"><ImageIcon size={20} className="text-gold-400" />{product ? 'بلا صورة حقيقية' : 'منتج تلقائي'}</span>}
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-navy-950/90 to-transparent p-2 pt-6">
                <span className="line-clamp-2 block text-[11px] font-bold leading-4 text-white" dir="auto">{v.idea.trim().split(' — ')[0] || 'فكرة يبتكرها المخرج'}</span>
                <span className="mt-1 inline-block rounded-full bg-gold-500 px-2 text-[9px] font-extrabold text-navy-950">اطلب الآن</span>
              </span>
            </div>
            <dl className="min-w-0 flex-1 space-y-1.5 text-xs lg:mt-3">
              <Row k="المنتج" val={productLabel} />
              <Row k="الصيغة" val={FORMAT_AR[v.format] ?? 'حسب الحساب'} />
              {occasionAr && <Row k="المناسبة" val={occasionAr} />}
              <Row k="الطريقة" val={design.renderMode === 'hybrid' ? 'هجين' : design.renderMode === 'ai_full' ? 'ذكاء كامل' : design.renderMode === 'layered' ? 'طبقات' : 'تلقائي'} />
              <div className="flex items-center justify-between border-t pt-1.5"><dt className="text-slate-500">التكلفة التقديرية</dt><dd className="ltr font-extrabold text-navy-900">{dryRun ? 'تجربة · $0' : `≈ $${cost.toFixed(3)}`}</dd></div>
              <div className="flex items-center justify-between"><dt className="text-slate-500">المدة المعتادة</dt><dd className="font-bold text-navy-900">{v.format === 'REEL_VIDEO' ? '2–4 دقائق' : '30–90 ثانية'}</dd></div>
            </dl>
          </div>
          <div className="hidden border-t p-3 lg:block">
            <Button type="button" variant="gold" className="w-full justify-center" onClick={create} disabled={!canCreate}><Sparkles size={16} /> إنشاء التصميم</Button>
            <p className="mt-1.5 text-center text-[10px] text-slate-500">الخيارات غير المحددة تلقائية.</p>
          </div>
        </div>
      </aside>
    </div>
  );
}

function Row({ k, val }: { k: string; val: string }) {
  return <div className="flex items-baseline justify-between gap-2"><dt className="shrink-0 text-slate-500">{k}</dt><dd className="min-w-0 truncate font-bold text-navy-900" dir="auto" title={val}>{val}</dd></div>;
}

function ProductTile({ selected, onPick, title, sub, photo, auto }: { selected: boolean; onPick: () => void; title: string; sub: string; photo?: string | null; auto?: boolean }) {
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onPick} title={title}
      className={cn('group flex min-w-0 flex-col overflow-hidden rounded-xl border-2 text-right transition', selected ? 'border-gold-500 ring-2 ring-gold-300/60' : 'border-slate-200 hover:border-gold-400')}>
      <span className="relative block aspect-square w-full bg-slate-100">
        {photo ? <img src={`/api/media/${photo}`} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />
          : <span className={cn('flex h-full items-center justify-center', auto ? 'bg-gradient-to-br from-navy-800 to-navy-950 text-gold-400' : 'text-slate-300')}>{auto ? <Sparkles size={22} /> : <ImageIcon size={20} />}</span>}
        {selected && <span className="absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-gold-500 text-navy-950"><Check size={12} /></span>}
      </span>
      <span className="block p-1.5"><span className="block truncate text-[11px] font-extrabold text-navy-900">{title}</span><span className="block truncate text-[10px] text-slate-500">{sub}</span></span>
    </button>
  );
}

function IdeaCard({ it, selected, onPick }: { it: Idea; selected: boolean; onPick: () => void }) {
  return (
    <button type="button" onClick={onPick} className={cn('rounded-xl border-2 p-3 text-right text-sm transition', selected ? 'border-gold-500 bg-gold-300/20' : 'border-slate-200 hover:border-gold-400')}>
      <div className="mb-1 flex flex-wrap gap-1 text-[11px]">
        {typeof it.score === 'number' && <span className="rounded-full bg-emerald-100 px-2 font-bold text-emerald-800">{it.score}/10</span>}
        {it.angle && <span className="rounded-full bg-gold-300/40 px-2 font-bold text-navy-900">{IDEA_ANGLES.find((a) => a.value === it.angle)?.ar ?? it.angle}</span>}
        {it.format && <span className="rounded-full bg-navy-800 px-2 font-bold text-white">{FORMAT_AR[it.format] ?? it.format}</span>}
        {it.status === 'APPROVED' && <span className="rounded-full bg-sky-100 px-2 font-bold text-sky-800">معتمدة</span>}
      </div>
      <div className="font-extrabold text-navy-900">{it.title}</div>
      {it.hook && <div className="mt-1 text-xs">🎣 {it.hook}</div>}
      <div className="mt-1 text-xs text-slate-600">{it.idea}</div>
      <div className="mt-2 text-xs font-bold text-gold-600">{selected ? '✓ مختارة' : 'اختر هذه الفكرة'}</div>
    </button>
  );
}
