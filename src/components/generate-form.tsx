'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { apiCall } from '@/lib/client/api';
import { Button, cn } from './ui';
import { CONCEPTS, CONTENT_TYPES, DESIGN_STYLES, IDEA_ANGLES, LANGUAGES, MARKETS, OCCASIONS, SEGMENTS } from '@/lib/creative/options';
import { DesignFields, designDirection, EMPTY_DESIGN, type DesignValues } from './design-fields';

type Opt = { id: string; label: string };
type Idea = { title: string; idea: string; hook?: string | null; angle?: string | null; format?: string | null; score?: number | null; productId?: string; status?: string };

const FORMATS = [
  { value: '', icon: '⚙️', title: 'حسب إعداد الحساب', hint: 'مزيج النمو أو الصيغة الثابتة للحساب' },
  { value: 'REEL_VIDEO', icon: '🎬', title: 'ريلز', hint: 'أعلى وصول لغير المتابعين', badge: 'الأقوى' },
  { value: 'IMAGE_CAROUSEL', icon: '🗂️', title: 'كاروسيل', hint: 'نصائح ومقارنات — يُحفظ ويُشارك' },
  { value: 'IMAGE_FEED', icon: '🖼️', title: 'منشور', hint: 'صورة واحدة قوية 1080×1350' },
  { value: 'IMAGE_STORY', icon: '📱', title: 'ستوري', hint: 'تذكير سريع 24 ساعة' },
  { value: 'IMAGE_SQUARE', icon: '⬛', title: 'مربع', hint: '1080×1080' },
] as const;
const STEPS = ['الحساب والمنتج', 'الفكرة', 'التصميم', 'المراجعة والإنشاء'];
const PHASES = ['كتابة الفكرة والنص', 'توليد الصورة', 'التركيب بالشعار والأرقام', 'فحص الجودة'];
const FORMAT_AR: Record<string, string> = { REEL_VIDEO: 'ريلز', IMAGE_CAROUSEL: 'كاروسيل', IMAGE_FEED: 'منشور', IMAGE_STORY: 'ستوري', IMAGE_SQUARE: 'مربع' };

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <div><label className="label">{label}</label>{children}{hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}</div>;
}

/**
 * «إنشاء تصميم جديد» — a 4-step flow in the order a designer works:
 * 1) account, product, format  2) the idea (bank / suggestions / own)  3) design method & style  4) review → create.
 * Every choice has an «تلقائي» default, so «إنشاء» works from any step.
 */
export function GenerateForm({ accounts, products, initialIdea = '' }: { accounts: Opt[]; products: Opt[]; initialIdea?: string }) {
  const router = useRouter();
  const [step, setStep] = useState(initialIdea ? 1 : 0);
  const [v, setV] = useState({ accountId: accounts[0]?.id ?? '', productId: '', format: '', language: '', contentType: '', market: '', segment: '', occasion: '', idea: initialIdea });
  const set = (k: keyof typeof v) => (val: string) => setV((x) => ({ ...x, [k]: val }));
  const [pq, setPq] = useState('');
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

  const filtered = useMemo(() => { const q = pq.trim(); return q ? products.filter((p) => p.label.includes(q)) : products; }, [pq, products]);
  const productLabel = products.find((p) => p.id === v.productId)?.label ?? 'تلقائي (يختاره النظام)';
  const accountLabel = accounts.find((a) => a.id === v.accountId)?.label ?? '—';

  const direction = () => {
    const d: Record<string, unknown> = {};
    for (const k of ['contentType', 'market', 'segment', 'occasion', 'idea'] as const) if (v[k].trim()) d[k] = v[k].trim();
    Object.assign(d, designDirection(design, v.format));
    return Object.keys(d).length ? d : undefined;
  };
  const common = () => ({ accountId: v.accountId, productId: v.productId || undefined, language: v.language || undefined, direction: direction() });
  const pickIdea = (it: Idea) => setV((x) => ({ ...x, idea: [it.title, it.idea, it.hook ? `الافتتاحية: ${it.hook}` : ''].filter(Boolean).join(' — ').slice(0, 500), ...(it.productId ? { productId: it.productId } : {}), ...(it.format && !x.format ? { format: it.format } : {}) }));

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
    // honest progress: the worker reports done/failed, not the phase — phases are shown as the plan, with elapsed time
    return (
      <div className="py-6 text-center">
        <div className="mx-auto mb-4 h-14 w-14 animate-spin rounded-full border-4 border-gold-300 border-t-navy-800" aria-hidden />
        <div className="text-lg font-extrabold text-navy-900">جارٍ إنشاء التصميم…</div>
        <p className="mt-1 text-sm text-slate-500">{elapsed} ثانية · عادة 30–90 ثانية (الريلز أطول)</p>
        <ol className="mx-auto mt-5 max-w-xs space-y-2 text-right text-sm text-slate-600">{PHASES.map((p, i) => <li key={p} className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-bold">{i + 1}</span>{p}</li>)}</ol>
        {stuck && <p role="alert" className="mx-auto mt-4 max-w-md rounded-lg bg-amber-50 p-3 text-sm text-amber-800">الطلب ما زال في الانتظار ولم يبدأ — غالبًا العامل الخلفي (worker) متوقف. افتح <a className="font-bold underline" href="/diagnostics">تشخيص النظام</a>، أو أعد التشغيل على السيرفر: <code dir="ltr">bash scripts/update.sh</code></p>}
        <p className="mt-4 text-xs text-slate-500">يمكنك مغادرة الصفحة — سيظهر التصميم في طابور الموافقات عند انتهائه.</p>
      </div>
    );
  }

  return (
    <div>
      <ol className="mb-6 grid grid-cols-4 gap-1">
        {STEPS.map((t, i) => (
          <li key={t}>
            <button type="button" onClick={() => setStep(i)} className="flex w-full flex-col items-center gap-1 text-center" aria-current={i === step ? 'step' : undefined}>
              <span className={cn('flex h-9 w-9 items-center justify-center rounded-full text-sm font-extrabold transition', i < step ? 'bg-emerald-600 text-white' : i === step ? 'bg-navy-800 text-white ring-4 ring-gold-300' : 'bg-slate-100 text-slate-500')}>{i < step ? <Check size={16} /> : i + 1}</span>
              <span className={cn('text-[11px] font-bold leading-tight sm:text-xs', i === step ? 'text-navy-900' : 'text-slate-500')}>{t}</span>
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="space-y-5">
          <Field label="الحساب"><select className="input" value={v.accountId} onChange={(e) => set('accountId')(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></Field>
          <Field label={`المنتج (${products.length})`} hint="اتركه «تلقائي» ليختار النظام منتجًا مناسبًا للحساب لم يُستخدم مؤخرًا.">
            <input className="input mb-2" value={pq} onChange={(e) => setPq(e.target.value)} placeholder="🔎 ابحث عن منتج: أكواب، ملصقات، بنر…" />
            <select className="input" value={v.productId} onChange={(e) => set('productId')(e.target.value)}>
              <option value="">تلقائي (يختاره النظام)</option>{filtered.slice(0, 200).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            {pq && <p className="mt-1 text-xs text-slate-500">{filtered.length} نتيجة</p>}
          </Field>
          <div><div className="label">الصيغة</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {FORMATS.map((f) => (
                <button key={f.value} type="button" onClick={() => set('format')(f.value)} className={cn('relative rounded-xl border-2 p-3 text-right transition', v.format === f.value ? 'border-gold-500 bg-gold-300/20' : 'border-slate-200 hover:border-gold-300')}>
                  {'badge' in f && <span className="absolute left-2 top-2 rounded-full bg-emerald-600 px-2 text-[10px] font-bold text-white">{f.badge}</span>}
                  <div className="text-xl">{f.icon}</div><div className="font-extrabold text-navy-900">{f.title}</div><div className="text-xs text-slate-500">{f.hint}</div>
                </button>
              ))}
            </div></div>
          <Field label="لغة المحتوى"><select className="input" value={v.language} onChange={(e) => set('language')(e.target.value)}><option value="">حسب لغة الحساب</option>{LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.ar}</option>)}</select></Field>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-5">
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
            <span className="text-xs text-slate-500">تراعي ذوقك وأسباب رفضك السابقة، ولا تكرر أفكار آخر 30 يومًا.</span>
          </div>
          {ideasBusy && <p className="text-sm text-slate-500" role="status">يفكّر المخرج الإبداعي في 3 أفكار… قد يستغرق ذلك حتى 30 ثانية.</p>}
          {ideasNote && <p role="alert" className={`rounded-lg p-2 text-sm ${ideasNote.kind === 'error' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}>{ideasNote.text}</p>}
          {ideas && <div className="grid gap-2 md:grid-cols-3">{ideas.map((it, i) => <IdeaCard key={i} it={it} selected={!!v.idea && v.idea.startsWith(it.title)} onPick={() => pickIdea(it)} />)}</div>}
          <Field label="الفكرة" hint="اكتب فكرتك، أو اختر فكرة أعلاه، أو اتركها فارغة ليبتكر المخرج الإبداعي فكرة. لا تذكر أسعارًا أو خصومات أو مدد تسليم.">
            <textarea rows={3} maxLength={500} className="input" value={v.idea} onChange={(e) => set('idea')(e.target.value)} placeholder="مثال: كوب مطبوع بصورة العائلة على طاولة إفطار رمضاني" />
          </Field>
          <details className="rounded-xl border p-3">
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
              ['الفكرة', v.idea.trim() || 'يبتكرها المخرج الإبداعي', 1],
              ['طريقة التصميم', design.renderMode === 'ai_full' ? 'تصميم كامل بالذكاء الاصطناعي (مع تصحيح الإملاء)' : design.renderMode === 'layered' ? 'طبقات النظام (نص مضمون 100%)' : 'تلقائي (موصى به)', 2],
              ['الأسلوب', DESIGN_STYLES.find((x) => x.value === design.designStyle)?.ar ?? 'تلقائي', 2],
              ['الفكرة البصرية', design.concept === 'none' ? 'بدون' : CONCEPTS.find((x) => x.value === design.concept)?.ar ?? 'تلقائي (تتناوب)', 2],
            ] as const).map(([k, val, s]) => (
              <div key={k} className="flex items-start justify-between gap-3 p-3"><dt className="shrink-0 text-slate-500">{k}</dt><dd className="flex-1 font-bold text-navy-900" dir="auto">{val}</dd>
                <button type="button" className="shrink-0 text-xs font-bold text-gold-600 underline" onClick={() => setStep(s)}>تعديل</button></div>
            ))}
          </dl>
          <p className="text-xs text-slate-500">بعد الإنشاء: فحص جودة آلي، ثم يصل لطابور الموافقات (أو يُنشر حسب التفويض الذاتي للحساب).</p>
        </div>
      )}

      {err && <p className="mt-4 rounded bg-red-50 p-2 text-sm text-red-700">{err}</p>}
      <div className="mt-6 flex items-center justify-between gap-2 border-t pt-4">
        {step > 0 ? <Button type="button" variant="outline" onClick={() => setStep(step - 1)}><ChevronRight size={16} /> السابق</Button> : <span />}
        <div className="flex flex-wrap justify-end gap-2">
          {step < 3 && <Button type="button" variant="outline" onClick={create} disabled={!v.accountId} title="باقي الاختيارات تلقائية">إنشاء الآن</Button>}
          {step < 3 ? <Button type="button" onClick={() => setStep(step + 1)} disabled={!v.accountId}>التالي <ChevronLeft size={16} /></Button>
            : <Button type="button" variant="gold" size="lg" onClick={create} disabled={!v.accountId}><Sparkles size={18} /> إنشاء التصميم</Button>}
        </div>
      </div>
    </div>
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
