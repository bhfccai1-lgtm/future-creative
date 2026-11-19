'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CATEGORIES, FINISHES, MATERIALS, METHODS, PRODUCTS, FAMILIES, type Product } from '@/lib/print/catalog';
import { INDUSTRIES } from '@/lib/print/identity';
import { csrfToken } from '@/lib/client/api';

type Lang = 'ar' | 'en';
type Status = 'PASS' | 'NEEDS_REVISION' | 'BLOCKED' | 'NOT_VERIFIED';
interface Row { id: string; title: string; productId: string; status: string; updatedAt: string; mockupKey: string | null }
interface Account { id: string; name: string }
interface Caps { disabledProducts: string[]; disabledMaterials: string[]; disabledFinishes: string[]; disabledMethods: string[]; pdfx: string; iccProfile: string }
interface Analysis { product: Product; familyAr: string; identity: { id: string; ar: string }; trim: { w: number; h: number }; bleedMm: number; safeMm: number; targetPpi: number; sides: number; pages: number; material: string | null; method: string | null; assumptions: string[]; warnings: string[]; blockers: string[]; productionPossible: boolean }
interface Concept { key: 'A' | 'B' | 'C'; name: string; idea: string; metaphor: string; palette: Record<string, string>; finishes: string[]; scores: Record<string, number>; total: number }
interface PageInfo { key: string; v: string; label: string; widthPx: number; heightPx: number; dpi: number; trimMm: { w: number; h: number }; bleedMm: number; folds: number[]; cut: string | null; kissCut: number; hidden: { label: string; rect: { x: number; y: number; w: number; h: number } }[]; safe: { x: number; y: number; w: number; h: number }[]; note: string | null }
interface Qa { checks: { level: string; id: string; label: string; status: Status; detail?: string }[]; levels: Record<string, Status>; overall: Status; productionReady: boolean }
interface Project { id: string; title: string; productId: string; status: string; brief: Brief; conceptKey: string | null; images: Record<string, string> | null; versions: { at: string; note: string }[] | null; exports: { at: string; files: { kind: string; name: string; key: string; bytes: number; note?: string }[] } | null; mockupKey: string | null; approvedAt: string | null }
interface Brief { productId: string; request: string; business: string; activity: string; audience: string; lang: 'ar' | 'en' | 'bi'; sizeId: string; orientation: 'portrait' | 'landscape'; sides?: 1 | 2; pages?: number; material?: string; finishes: string[]; outputs: 'print' | 'ad' | 'both'; viewM?: number; conditions: { outdoor: boolean; waterproof: boolean; food: boolean; darkFabric: boolean }; finishTarget?: 'logo_headline' | 'logo' | 'headline' | 'name'; texts: Texts; shopBrandingConsent: boolean; logoKey?: string; dielineKey?: string; dieline?: { wMm: number; hMm: number; panels: { x: number; y: number; w: number; h: number }[]; fold: string[]; warnings: string[] }; frontPanel?: number }

/** same text on the server and in the browser (no locale / time-zone drift → no hydration mismatch) */
const DATE_FMT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bahrain', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const fmtDate = (d: string | Date) => DATE_FMT.format(new Date(d));
type Verdict = 'ok' | 'acceptable' | 'low';
interface ImagePlan { done: boolean; live: boolean; costUsd: number; areaMm: { w: number; h: number } | null; target: number; eye: number | null; viewM: number | null; ai: { px: string; ppi: number; verdict: Verdict } | null; current: { px: string; ppi: number; verdict: Verdict; upscale: number; source: 'ai' | 'upload' } | null; needPx: { w: number; h: number } | null }
type Texts = { headline: string; subline: string; body: string; name: string; role: string; phone: string; email: string; website: string; address: string; cta: string; extra: string[] };
const STATUS_STYLE: Record<Status, string> = { PASS: 'bg-emerald-100 text-emerald-800', NEEDS_REVISION: 'bg-amber-100 text-amber-800', BLOCKED: 'bg-red-100 text-red-800', NOT_VERIFIED: 'bg-slate-100 text-slate-700' };
const STATUS_AR: Record<Status, string> = { PASS: 'ناجح', NEEDS_REVISION: 'يحتاج تعديل', BLOCKED: 'موقوف', NOT_VERIFIED: 'غير متحقق' };
const LEVEL_AR: Record<string, [string, string]> = { visual: ['الفحص البصري', 'Visual QA'], brand: ['الهوية', 'Brand QA'], language: ['اللغة', 'Language QA'], technical: ['الفني', 'Technical QA'], print: ['الطباعة', 'Print QA'], publishing: ['النشر', 'Publishing QA'] };
const PROJ_STATUS: Record<string, [string, string]> = { draft: ['مسودة', 'Draft'], designed: ['بانتظار المراجعة', 'In review'], approved: ['معتمد', 'Approved'], exported: ['ملفات جاهزة', 'Files ready'] };
const blankBrief = (productId = 'business_card'): Brief => ({ productId, request: '', business: '', activity: '', audience: '', lang: 'ar', sizeId: '', orientation: 'portrait', finishes: [], outputs: 'print', conditions: { outdoor: false, waterproof: false, food: false, darkFabric: false }, texts: { headline: '', subline: '', body: '', name: '', role: '', phone: '', email: '', website: '', address: '', cta: '', extra: [] }, shopBrandingConsent: false });

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { 'x-csrf-token': csrfToken(), ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(init?.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || j.error || `HTTP ${r.status}`);
  return j as T;
}

export function PrintStudio({ initial, accounts, caps: caps0, canAdmin, shop }: { initial: Row[]; accounts: Account[]; caps: Caps; canAdmin: boolean; shop: { logo: boolean; phones: { name: string; phone: string }[] } }) {
  const [ui, setUi] = useState<Lang>('ar');
  const L = (ar: string, en: string) => (ui === 'ar' ? ar : en);
  const [tab, setTab] = useState<'dashboard' | 'catalog' | 'new' | 'project' | 'brand'>('dashboard');
  const [rows, setRows] = useState<Row[]>(initial);
  const [caps, setCaps] = useState<Caps>(caps0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const run = useCallback(async <T,>(label: string, fn: () => Promise<T>, ok?: string) => {
    setBusy(label); setMsg(null);
    try { const r = await fn(); if (ok) setMsg({ ok: true, text: ok }); return r; } catch (e) { setMsg({ ok: false, text: (e as Error).message }); return null; } finally { setBusy(''); }
  }, []);
  const refreshRows = useCallback(async () => { const r = await call<{ projects: Row[] }>('/api/print/projects'); setRows(r.projects); }, []);
  const open = (id: string) => { setOpenId(id); setTab('project'); };

  return (
    <div className="space-y-4" dir={ui === 'ar' ? 'rtl' : 'ltr'}>
      <header className="rounded-2xl bg-gradient-to-l from-slate-900 via-indigo-900 to-amber-700 p-4 text-white">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><div className="text-xl font-extrabold tracking-wide">PRINT DESIGN STUDIO <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">V6.0</span></div>
            <div className="text-xs opacity-90">{L('تصميم وتجهيز جميع المطبوعات — من الطلب حتى ملف الإنتاج', 'Every print product — from request to production file')}</div></div>
          <button type="button" className="rounded-full bg-white/15 px-3 py-1 text-xs font-bold" onClick={() => setUi(ui === 'ar' ? 'en' : 'ar')}>{ui === 'ar' ? 'English' : 'عربي'}</button>
        </div>
      </header>
      <nav className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="sections">
        {([['dashboard', 'لوحة المشاريع', 'Dashboard'], ['new', 'تصميم جديد', 'AI Design Generator'], ['catalog', 'كتالوج المنتجات', 'Product Catalog'], ['project', 'المشروع', 'Project'], ['brand', 'الهوية', 'Brand Identity']] as const).map(([k, ar, en]) => (
          <button key={k} type="button" disabled={k === 'project' && !openId} onClick={() => setTab(k)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${tab === k ? 'bg-indigo-700 text-white' : 'border bg-white text-slate-700 disabled:opacity-40'}`}>{L(ar, en)}</button>
        ))}
      </nav>
      {busy && <div className="rounded-xl bg-sky-50 p-3 text-sm font-bold text-sky-800">⏳ {busy}</div>}
      {msg && <div role="status" className={`rounded-xl p-3 text-sm font-bold ${msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>{msg.text}</div>}

      {tab === 'dashboard' && <Dashboard rows={rows} L={L} onOpen={open} onNew={() => setTab('new')} />}
      {tab === 'catalog' && <Catalog caps={caps} canAdmin={canAdmin} L={L} onPick={(id) => { setTab('new'); setTimeout(() => window.dispatchEvent(new CustomEvent('print:pick', { detail: id })), 0); }} onCaps={async (next) => { const r = await run(L('حفظ إمكانات المطبعة', 'Saving capabilities'), () => call<{ print: Caps }>('/api/print/capabilities', { method: 'PUT', body: JSON.stringify(next) }), L('حُفظت إمكانات المطبعة ✓', 'Saved ✓')); if (r) setCaps(r.print); }} />}
      {tab === 'new' && <Generator L={L} ui={ui} caps={caps} busy={!!busy} onCreate={async (b) => { const r = await run(L('تحليل الطلب وابتكار ثلاثة اتجاهات وإنشاء التصميم…', 'Analysing, ideating and designing…'), () => call<{ project: Project }>('/api/print/projects', { method: 'POST', body: JSON.stringify(b) })); if (r) { await refreshRows(); open(r.project.id); } }} />}
      {tab === 'project' && openId && <ProjectView key={openId} id={openId} L={L} ui={ui} accounts={accounts} run={run} busy={!!busy} onChanged={refreshRows} onDeleted={async () => { setOpenId(null); setTab('dashboard'); await refreshRows(); }} />}
      {tab === 'brand' && <BrandPanel L={L} shop={shop} />}
    </div>
  );
}

function Dashboard({ rows, L, onOpen, onNew }: { rows: Row[]; L: (a: string, e: string) => string; onOpen: (id: string) => void; onNew: () => void }) {
  const counts = useMemo(() => rows.reduce<Record<string, number>>((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {}), [rows]);
  return (
    <section className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{(['designed', 'approved', 'exported'] as const).map((s) => (<div key={s} className="rounded-xl border bg-white p-3"><div className="text-2xl font-extrabold">{counts[s] ?? 0}</div><div className="text-xs text-slate-500">{L(PROJ_STATUS[s][0], PROJ_STATUS[s][1])}</div></div>))}
        <button type="button" onClick={onNew} className="rounded-xl bg-indigo-700 p-3 text-sm font-extrabold text-white">+ {L('تصميم احترافي جديد', 'New professional design')}</button></div>
      {!rows.length ? <p className="rounded-xl border border-dashed bg-white p-6 text-center text-sm text-slate-500">{L('لا توجد مشاريع بعد — ابدأ بتصميم جديد.', 'No projects yet.')}</p> : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{rows.map((r) => { const p = PRODUCTS.find((x) => x.id === r.productId); return (
          <li key={r.id}><button type="button" onClick={() => onOpen(r.id)} className="flex w-full items-center gap-3 rounded-xl border bg-white p-2 text-start">
            {r.mockupKey ? <img src={`/api/media/${r.mockupKey}`} alt="" className="h-16 w-20 shrink-0 rounded-lg object-cover" /> : <div className="grid h-16 w-20 shrink-0 place-items-center rounded-lg bg-slate-100 text-[10px] text-slate-500">{p ? FAMILIES[p.family].ar : ''}</div>}
            <div className="min-w-0 flex-1"><div className="truncate font-bold">{r.title}</div><div className="truncate text-xs text-slate-500">{p ? L(p.ar, p.en) : r.productId} · {L(PROJ_STATUS[r.status]?.[0] ?? r.status, PROJ_STATUS[r.status]?.[1] ?? r.status)}</div><div className="text-[10px] text-slate-400" dir="ltr">{fmtDate(r.updatedAt)}</div></div>
          </button></li>); })}</ul>)}
    </section>
  );
}

function Catalog({ caps, canAdmin, L, onPick, onCaps }: { caps: Caps; canAdmin: boolean; L: (a: string, e: string) => string; onPick: (id: string) => void; onCaps: (c: Partial<Caps>) => void }) {
  const [cat, setCat] = useState('A');
  const [edit, setEdit] = useState(false);
  const list = PRODUCTS.filter((p) => p.cat === cat);
  const toggle = (key: 'disabledProducts' | 'disabledMaterials' | 'disabledFinishes' | 'disabledMethods', id: string) => onCaps({ [key]: caps[key].includes(id) ? caps[key].filter((x) => x !== id) : [...caps[key], id] });
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-slate-500">{PRODUCTS.length} {L('منتجًا في 11 فئة · القيم نقاط بداية شائعة وليست معايير إلزامية — تُضبط حسب المطبعة والمورد والخامة.', 'products in 11 categories · values are common starting points, not universal standards.')}</p>
        {canAdmin && <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-bold" onClick={() => setEdit(!edit)}>{edit ? L('إنهاء التعديل', 'Done') : L('تحديد إمكانات المطبعة', 'Set shop capabilities')}</button>}</div>
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">{Object.entries(CATEGORIES).map(([k, v]) => <button key={k} type="button" onClick={() => setCat(k)} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${cat === k ? 'bg-slate-900 text-white' : 'border bg-white'}`}>{k}. {L(v.ar, v.en)}</button>)}</div>
      <ul className="grid gap-2 sm:grid-cols-2">{list.map((p) => { const off = caps.disabledProducts.includes(p.id); const fam = FAMILIES[p.family]; return (
        <li key={p.id} className={`rounded-xl border bg-white p-3 ${off ? 'opacity-50' : ''}`}>
          <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="font-bold">{L(p.ar, p.en)}</div><div className="text-[11px] text-slate-500">{fam.ar} · {L('نزيف', 'bleed')} {fam.bleedMm} {L('مم', 'mm')} · {L('أمان', 'safe')} {fam.safeMm} {L('مم', 'mm')} · {p.viewM ? `${L('مشاهدة', 'view')} ${p.viewM} م` : `${fam.ppi} PPI`}{fam.requires?.length ? ` · ${L('يتطلب', 'needs')}: ${fam.requires.join('، ')}` : ''}</div></div>
            {edit ? <label className="flex shrink-0 items-center gap-1 text-xs"><input type="checkbox" checked={!off} onChange={() => toggle('disabledProducts', p.id)} />{L('متاح', 'offered')}</label> : <button type="button" disabled={off} onClick={() => onPick(p.id)} className="shrink-0 rounded-lg bg-indigo-700 px-3 py-1.5 text-xs font-bold text-white disabled:bg-slate-300">{L('صمّم', 'Design')}</button>}</div>
          <div className="mt-1 text-[11px] text-slate-600">{p.sizes.map((s) => s.ar).join(' · ')}</div>
          <div className="mt-1 flex flex-wrap gap-1">{p.materials.map((m) => <Tag key={m} off={caps.disabledMaterials.includes(m)} onClick={edit ? () => toggle('disabledMaterials', m) : undefined}>{MATERIALS[m]?.ar ?? m}</Tag>)}{p.finishes.map((f) => <Tag key={f} gold off={caps.disabledFinishes.includes(f)} onClick={edit ? () => toggle('disabledFinishes', f) : undefined}>{FINISHES[f]?.ar ?? f}</Tag>)}{p.methods.map((m) => <Tag key={m} blue off={caps.disabledMethods.includes(m)} onClick={edit ? () => toggle('disabledMethods', m) : undefined}>{METHODS[m] ?? m}</Tag>)}</div>
        </li>); })}</ul>
      {edit && <div className="grid gap-2 rounded-xl border bg-white p-3 sm:grid-cols-2">
        <label className="text-xs font-bold">PDF/X {L('المطلوب من المطبعة', 'required by the printer')}<select className="input mt-1" value={caps.pdfx} onChange={(e) => onCaps({ pdfx: e.target.value })}><option value="none">{L('لا يُطلب', 'none')}</option><option value="x1a">PDF/X-1a</option><option value="x4">PDF/X-4</option></select></label>
        <label className="text-xs font-bold">{L('ملف ICC للمطبعة (اسم الملف في مجلد الخطوط)', 'Printer ICC profile (file in the fonts dir)')}<input className="input ltr mt-1" defaultValue={caps.iccProfile} onBlur={(e) => onCaps({ iccProfile: e.target.value.trim() })} placeholder="ISOcoated_v2.icc" /></label>
        <p className="text-[11px] text-slate-500 sm:col-span-2">{L('ما يُلغى هنا يظهر معطّلًا ولا يقترحه النظام أبدًا. النظام لا يصدّر PDF/X حاليًا — يظهر كـ «غير متحقق» إن طلبته المطبعة.', 'Disabled items are never proposed. PDF/X is not produced — reported NOT_VERIFIED when required.')}</p></div>}
    </section>
  );
}
function Tag({ children, gold, blue, off, onClick }: { children: React.ReactNode; gold?: boolean; blue?: boolean; off?: boolean; onClick?: () => void }) {
  const cls = `rounded-full px-2 py-0.5 text-[10px] font-bold ${off ? 'bg-slate-100 text-slate-400 line-through' : gold ? 'bg-amber-50 text-amber-800' : blue ? 'bg-sky-50 text-sky-800' : 'bg-slate-100 text-slate-700'}`;
  return onClick ? <button type="button" onClick={onClick} className={cls}>{children}</button> : <span className={cls}>{children}</span>;
}

function Generator({ L, ui, caps, busy, onCreate }: { L: (a: string, e: string) => string; ui: Lang; caps: Caps; busy: boolean; onCreate: (b: Brief) => void }) {
  const [b, setB] = useState<Brief>(blankBrief());
  const [cat, setCat] = useState('A');
  const [an, setAn] = useState<{ analysis: Analysis; concepts: Concept[]; best: string; available: { materials: string[]; finishes: string[]; methods: string[] } } | null>(null);
  const product = PRODUCTS.find((p) => p.id === b.productId)!;
  const set = <K extends keyof Brief>(k: K, v: Brief[K]) => setB((x) => ({ ...x, [k]: v }));
  const setT = (k: Exclude<keyof Texts, 'extra'>, v: string) => setB((x) => ({ ...x, texts: { ...x.texts, [k]: v } }));
  useEffect(() => { const h = (e: Event) => { const id = (e as CustomEvent<string>).detail; const p = PRODUCTS.find((x) => x.id === id); if (p) { setCat(p.cat); setB((x) => ({ ...x, productId: id, sizeId: '' })); } }; window.addEventListener('print:pick', h); return () => window.removeEventListener('print:pick', h); }, []);
  useEffect(() => { const t = setTimeout(() => { call<NonNullable<typeof an>>('/api/print/analyze', { method: 'POST', body: JSON.stringify(b) }).then(setAn).catch(() => setAn(null)); }, 500); return () => clearTimeout(t); }, [b]);
  const fam = product.family;
  const card = fam === 'card', big = fam === 'large_format';
  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <form className="min-w-0 space-y-4 rounded-2xl border bg-white p-4" onSubmit={(e) => { e.preventDefault(); onCreate(b); }}>
        <Step n={1} title={L('نوع المنتج', 'Product')}>
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">{Object.entries(CATEGORIES).map(([k, v]) => <button key={k} type="button" onClick={() => setCat(k)} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${cat === k ? 'bg-slate-900 text-white' : 'border bg-white'}`}>{L(v.ar, v.en)}</button>)}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">{PRODUCTS.filter((p) => p.cat === cat).map((p) => { const off = caps.disabledProducts.includes(p.id); return <button key={p.id} type="button" disabled={off} onClick={() => setB((x) => ({ ...x, productId: p.id, sizeId: '' }))} className={`rounded-full border px-3 py-1.5 text-xs font-bold ${b.productId === p.id ? 'border-indigo-700 bg-indigo-700 text-white' : 'bg-white disabled:opacity-40'}`}>{L(p.ar, p.en)}</button>; })}</div>
        </Step>
        <Step n={2} title={L('نشاط العميل أو المناسبة', 'Client activity / occasion')}>
          <input className="input" value={b.activity} onChange={(e) => set('activity', e.target.value)} placeholder={L('مثال: مقهى قهوة مختصة، عيادة أسنان، متجر عطور', 'e.g. specialty café, dental clinic, perfume store')} />
          <div className="mt-2 flex flex-wrap gap-1.5">{INDUSTRIES.slice(0, 12).map((i) => <button key={i.id} type="button" onClick={() => set('activity', i.ar)} className="rounded-full border bg-white px-2.5 py-1 text-[11px] font-bold">{L(i.ar, i.en)}</button>)}</div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2"><input className="input" value={b.business} onChange={(e) => set('business', e.target.value)} placeholder={L('اسم النشاط / العميل', 'Business name')} /><input className="input" value={b.audience} onChange={(e) => set('audience', e.target.value)} placeholder={L('الجمهور المستهدف (اختياري)', 'Audience (optional)')} /></div>
        </Step>
        <Step n={3} title={L('المقاس والاتجاه', 'Size & orientation')}>
          <div className="flex flex-wrap gap-1.5">{product.sizes.map((s) => <button key={s.id} type="button" onClick={() => set('sizeId', s.id)} className={`rounded-full border px-3 py-1.5 text-xs font-bold ${b.sizeId === s.id || (!b.sizeId && s === product.sizes[0]) ? 'border-indigo-700 bg-indigo-50 text-indigo-900' : 'bg-white'}`}>{s.ar}</button>)}</div>
          {['sheet', 'multipage', 'large_format'].includes(fam) && <div className="mt-2 flex gap-2">{(['portrait', 'landscape'] as const).map((o) => <button key={o} type="button" onClick={() => set('orientation', o)} className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${b.orientation === o ? 'bg-slate-900 text-white' : 'bg-white'}`}>{o === 'portrait' ? L('عمودي', 'Portrait') : L('أفقي', 'Landscape')}</button>)}</div>}
          {big && <label className="mt-2 block text-xs font-bold">{L('مسافة المشاهدة (متر) — تحدد الدقة وحجم العنوان', 'Viewing distance (m) — sets resolution and headline size')}<input className="input ltr mt-1" type="number" min={0.3} max={100} step="any" value={b.viewM ?? product.viewM ?? ''} onChange={(e) => set('viewM', Number(e.target.value) || undefined)} /></label>}
        </Step>
        <Step n={4} title={L('اللغة والجهات', 'Language & sides')}>
          <div className="flex flex-wrap gap-2">{([['ar', 'عربي'], ['en', 'English'], ['bi', L('ثنائي اللغة', 'Bilingual')]] as const).map(([v, l]) => <button key={v} type="button" onClick={() => set('lang', v)} className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${b.lang === v ? 'bg-slate-900 text-white' : 'bg-white'}`}>{l}</button>)}
            {product.sides === 2 && fam !== 'folded' && ([1, 2] as const).map((n) => <button key={n} type="button" onClick={() => set('sides', n)} className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${(b.sides ?? product.sides) === n ? 'bg-indigo-700 text-white' : 'bg-white'}`}>{n === 1 ? L('وجه واحد', 'One side') : L('وجهان', 'Two sides')}</button>)}
            {fam === 'multipage' && <label className="text-xs font-bold">{L('عدد الصفحات', 'Pages')} <input className="input ltr !w-24" type="number" min={4} max={1000} value={b.pages ?? product.pages ?? 8} onChange={(e) => set('pages', Number(e.target.value))} /></label>}</div>
        </Step>
        <Step n={5} title={L('النصوص والبيانات (من العميل فقط)', 'Texts & data (from the client only)')}>
          <div className="grid gap-2 sm:grid-cols-2">
            <input className="input" value={b.texts.headline} onChange={(e) => setT('headline', e.target.value)} placeholder={L('العنوان الرئيسي', 'Headline')} />
            <input className="input" value={b.texts.subline} onChange={(e) => setT('subline', e.target.value)} placeholder={L('سطر فرعي / شعار نصي', 'Sub-line / tagline')} />
            {card && <><input className="input" value={b.texts.name} onChange={(e) => setT('name', e.target.value)} placeholder={L('الاسم', 'Name')} /><input className="input" value={b.texts.role} onChange={(e) => setT('role', e.target.value)} placeholder={L('المسمى الوظيفي', 'Role')} /></>}
            <input className="input ltr" inputMode="tel" value={b.texts.phone} onChange={(e) => setT('phone', e.target.value)} placeholder={L('الهاتف', 'Phone')} />
            <input className="input ltr" inputMode="email" value={b.texts.email} onChange={(e) => setT('email', e.target.value)} placeholder={L('البريد', 'Email')} />
            <input className="input ltr" value={b.texts.website} onChange={(e) => setT('website', e.target.value)} placeholder={L('الموقع / إنستغرام', 'Website / Instagram')} />
            <input className="input" value={b.texts.address} onChange={(e) => setT('address', e.target.value)} placeholder={L('العنوان', 'Address')} />
            {!card && <><input className="input" value={b.texts.cta} onChange={(e) => setT('cta', e.target.value)} placeholder={L('دعوة للتواصل (مثل: اطلب الآن)', 'Call to action')} />
              <textarea className="input sm:col-span-2" rows={2} value={b.texts.extra.join('\n')} onChange={(e) => setB((x) => ({ ...x, texts: { ...x.texts, extra: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 12) } }))} placeholder={L('نقاط / خدمات (سطر لكل نقطة)', 'Points / services (one per line)')} />
              <textarea className="input sm:col-span-2" rows={2} value={b.texts.body} onChange={(e) => setT('body', e.target.value)} placeholder={L('نص تعريفي (اختياري)', 'Body text (optional)')} /></>}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">{L('لا يخترع النظام أسماء أو أرقامًا أو أسعارًا — ما لا تكتبه يبقى فارغًا. الشعار يُرفع من صفحة المشروع (الملف الأصلي فقط).', 'Nothing is invented — empty stays empty. Upload the logo on the project page (original file only).')}</p>
        </Step>
        <Step n={6} title={L('الخامة وشروط الاستخدام', 'Material & conditions')}>
          <div className="flex flex-wrap gap-3 text-xs">{([['outdoor', 'خارجي/شمس', 'Outdoor'], ['waterproof', 'مقاوم للماء', 'Waterproof'], ['food', 'ملامس للأغذية', 'Food contact'], ['darkFabric', 'قماش داكن', 'Dark fabric']] as const).map(([k, ar, en]) => <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={b.conditions[k]} onChange={(e) => set('conditions', { ...b.conditions, [k]: e.target.checked })} />{L(ar, en)}</label>)}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">{(an?.available.materials ?? product.materials).map((m) => <button key={m} type="button" onClick={() => set('material', m)} className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${(b.material ?? an?.analysis.material) === m ? 'border-indigo-700 bg-indigo-50 text-indigo-900' : 'bg-white'}`}>{MATERIALS[m]?.ar ?? m}</button>)}</div>
          {(an?.available.finishes.length ?? 0) > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{an!.available.finishes.map((f) => <button key={f} type="button" onClick={() => set('finishes', b.finishes.includes(f) ? b.finishes.filter((x) => x !== f) : [...b.finishes, f])} className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${b.finishes.includes(f) ? 'border-amber-600 bg-amber-50 text-amber-900' : 'bg-white'}`}>{FINISHES[f]?.ar ?? f}</button>)}</div>}
          {b.finishes.some((f) => FINISHES[f]?.separation) && <div className="mt-2"><div className="text-[11px] font-bold text-slate-600">{L('عناصر التشطيب (فويل / Spot UV / بارز)', 'Elements that get the finish')}</div><div className="mt-1 flex flex-wrap gap-1.5">{([['logo_headline', 'الشعار والعنوان', 'Logo + headline'], ['logo', 'الشعار فقط', 'Logo only'], ['headline', 'العنوان فقط', 'Headline only'], ['name', 'الاسم والشعار', 'Name + logo']] as const).map(([v, ar, en]) => <button key={v} type="button" onClick={() => set('finishTarget', v)} className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${(b.finishTarget ?? 'logo_headline') === v ? 'border-amber-600 bg-amber-50 text-amber-900' : 'bg-white'}`}>{L(ar, en)}</button>)}</div><p className="mt-1 text-[11px] text-slate-500">{L('يُنشأ لكل تشطيب ملف فصل مستقل (أسود 100٪) مطابق لموضع التصميم.', 'Each finish gets its own aligned 100 % black plate.')}</p></div>}
        </Step>
        <Step n={7} title={L('نوع المخرجات', 'Output')}>
          <div className="flex flex-wrap gap-2">{([['print', 'طباعة فعلية', 'Print'], ['ad', 'إعلان', 'Ad'], ['both', 'كلاهما', 'Both']] as const).map(([v, ar, en]) => <button key={v} type="button" onClick={() => set('outputs', v)} className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${b.outputs === v ? 'bg-slate-900 text-white' : 'bg-white'}`}>{L(ar, en)}</button>)}</div>
          <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={b.shopBrandingConsent} onChange={(e) => set('shopBrandingConsent', e.target.checked)} />{L('العميل وافق على وضع هوية المطبعة داخل منتجه (افتراضيًا: لا)', 'Client agreed to the printer’s branding inside the product (default: no)')}</label>
        </Step>
        <button type="submit" disabled={busy} className="w-full rounded-xl bg-gradient-to-l from-indigo-700 to-amber-600 p-3 text-base font-extrabold text-white disabled:opacity-50">✨ {L('إنشاء تصميم احترافي', 'Create professional design')}</button>
      </form>
      <aside className="space-y-3">
        {an && <AnalysisCard an={an.analysis} concepts={an.concepts} best={an.best} L={L} ui={ui} />}
      </aside>
    </section>
  );
}
function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return <fieldset className="min-w-0"><legend className="mb-2 flex items-center gap-2 text-sm font-extrabold text-indigo-900"><span className="grid h-6 w-6 place-items-center rounded-full bg-indigo-700 text-xs text-white">{n}</span>{title}</legend>{children}</fieldset>;
}

function AnalysisCard({ an, concepts, best, L, ui }: { an: Analysis; concepts: Concept[]; best: string; L: (a: string, e: string) => string; ui: Lang }) {
  return (
    <div className="space-y-3 rounded-2xl border bg-white p-3 text-sm">
      <div className="font-extrabold">{L('تحليل الطلب', 'Request analysis')}</div>
      <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
        <dt className="text-slate-500">{L('المنتج', 'Product')}</dt><dd className="font-bold">{ui === 'ar' ? an.product.ar : an.product.en}</dd>
        <dt className="text-slate-500">{L('النشاط', 'Activity')}</dt><dd className="font-bold">{an.identity.ar}</dd>
        <dt className="text-slate-500">{L('المقاس النهائي', 'Trim')}</dt><dd className="font-bold" dir="ltr">{an.trim.w}×{an.trim.h} mm</dd>
        <dt className="text-slate-500">{L('نزيف / أمان', 'Bleed / safe')}</dt><dd className="font-bold" dir="ltr">{an.bleedMm} / {an.safeMm} mm</dd>
        <dt className="text-slate-500">{L('الدقة المستهدفة', 'Target PPI')}</dt><dd className="font-bold" dir="ltr">{an.targetPpi} PPI</dd>
        <dt className="text-slate-500">{L('الخامة', 'Material')}</dt><dd className="font-bold">{an.material ? MATERIALS[an.material]?.ar ?? an.material : '—'}</dd>
        <dt className="text-slate-500">{L('الطباعة', 'Method')}</dt><dd className="font-bold">{an.method ? METHODS[an.method] ?? an.method : '—'}</dd>
      </dl>
      {an.blockers.length > 0 && <List cls="bg-red-50 text-red-800" title={L('يمنع الإنتاج (معاينة فقط)', 'Blocks production (preview only)')} items={an.blockers} />}
      {an.warnings.length > 0 && <List cls="bg-amber-50 text-amber-900" title={L('تنبيهات', 'Warnings')} items={an.warnings} />}
      {an.assumptions.length > 0 && <List cls="bg-slate-50 text-slate-700" title={L('افتراضات تصميمية', 'Design assumptions')} items={an.assumptions} />}
      <div className="font-extrabold">{L('ثلاثة اتجاهات إبداعية', 'Three creative directions')}</div>
      {concepts.map((c) => <ConceptCard key={c.key} c={c} best={c.key === best} L={L} />)}
    </div>
  );
}
function ConceptCard({ c, best, L, onPick, active }: { c: Concept; best: boolean; L: (a: string, e: string) => string; onPick?: () => void; active?: boolean }) {
  const SC: Record<string, string> = { relevance: 'الارتباط', audience: 'الجمهور', appeal: 'الجاذبية', clarity: 'الوضوح', production: 'سهولة الإنتاج', finishCost: 'تكلفة التشطيب' };
  return (
    <div className={`rounded-xl border p-2 ${active ? 'border-indigo-700 ring-2 ring-indigo-200' : best ? 'border-emerald-500' : ''}`}>
      <div className="flex items-center justify-between gap-2"><div className="font-bold">{c.key}. {c.name}{best && <span className="ms-1 rounded-full bg-emerald-100 px-1.5 text-[10px] text-emerald-800">{L('الأفضل', 'best')}</span>}</div><span className="text-xs font-extrabold" dir="ltr">{c.total}/10</span></div>
      <div className="mt-1 flex gap-1">{Object.values(c.palette).slice(0, 4).map((col, i) => <span key={i} className="h-4 w-6 rounded" style={{ background: col }} />)}</div>
      <p className="mt-1 text-[11px] text-slate-600">{c.idea}</p>
      <p className="text-[11px] text-slate-500">💡 {c.metaphor}</p>
      <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-slate-500">{Object.entries(c.scores).map(([k, v]) => <span key={k}>{SC[k] ?? k} {v}</span>)}</div>
      {onPick && <button type="button" onClick={onPick} disabled={active} className="mt-1 w-full rounded-lg border px-2 py-1 text-xs font-bold disabled:bg-indigo-50">{active ? L('المختار', 'Selected') : L('اختر هذا الاتجاه', 'Use this direction')}</button>}
    </div>
  );
}
const List = ({ cls, title, items }: { cls: string; title: string; items: string[] }) => <div className={`rounded-lg p-2 text-xs ${cls}`}><div className="font-bold">{title}</div><ul className="mt-1 list-disc space-y-0.5 ps-4">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>;

function ProjectView({ id, L, ui, accounts, run, busy, onChanged, onDeleted }: { id: string; L: (a: string, e: string) => string; ui: Lang; accounts: Account[]; run: <T>(label: string, fn: () => Promise<T>, ok?: string) => Promise<T | null>; busy: boolean; onChanged: () => void; onDeleted: () => void }) {
  const [p, setP] = useState<Project | null>(null);
  const [pv, setPv] = useState<{ pages: PageInfo[]; qa: Qa; analysis: Analysis; concepts: Concept[]; concept: string } | null>(null);
  const [sub, setSub] = useState<'design' | 'mockup' | 'prepress' | 'qa' | 'ad' | 'export' | 'history'>('design');
  const [page, setPage] = useState(0);
  const [guides, setGuides] = useState(true);
  const [plan, setPlan] = useState<ImagePlan | null>(null);
  const [texts, setTexts] = useState<Record<string, string> | null>(null);
  const load = useCallback(async () => {
    const r = await call<{ project: Project }>(`/api/print/projects/${id}`); setP(r.project); setTexts({ ...r.project.brief.texts, extra: r.project.brief.texts.extra.join('\n') });
    const v = await call<{ pages: PageInfo[]; qa: Qa; analysis: Analysis; concepts: Concept[]; concept: string }>(`/api/print/projects/${id}/preview`, { method: 'POST' }); setPv(v); setPage((x) => Math.min(x, v.pages.length - 1));
    call<ImagePlan>(`/api/print/projects/${id}/image`).then(setPlan).catch(() => setPlan(null));
  }, [id]);
  useEffect(() => { void run(L('تجهيز المعاينة…', 'Preparing preview…'), load); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!p || !pv) return <p className="text-sm text-slate-500">…</p>;
  const cur = pv.pages[page];
  const approved = p.status === 'approved' || p.status === 'exported';
  const act = async (action: string, label: string, ok: string, body?: unknown) => { const r = await run(label, () => call<Record<string, unknown>>(`/api/print/projects/${id}/${action}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined }), ok); if (r) { await load(); onChanged(); } return r; };
  const patch = async (body: unknown, label: string) => { const r = await run(label, () => call(`/api/print/projects/${id}`, { method: 'PATCH', body: JSON.stringify(body) }), L('حُفظ — المعاينة محدثة ✓', 'Saved ✓')); if (r) { await load(); onChanged(); } };
  const upload = async (kind: 'logo' | 'dieline' | 'hero', f: File) => { const fd = new FormData(); fd.append('file', f); fd.append('kind', kind); const r = await run(L('رفع الملف…', 'Uploading…'), () => call(`/api/print/projects/${id}/upload`, { method: 'POST', body: fd }), L('رُفع الملف الأصلي ✓', 'Uploaded ✓')); if (r) { await load(); onChanged(); } };
  const kx = cur ? 100 / cur.widthPx : 1, ky = cur ? 100 / cur.heightPx : 1;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border bg-white p-3">
        <div className="min-w-0"><div className="truncate text-lg font-extrabold">{p.title}</div><div className="text-xs text-slate-500">{ui === 'ar' ? pv.analysis.product.ar : pv.analysis.product.en} · <span dir="ltr">{pv.analysis.trim.w}×{pv.analysis.trim.h} mm</span> · {L(PROJ_STATUS[p.status]?.[0] ?? p.status, PROJ_STATUS[p.status]?.[1] ?? p.status)}</div></div>
        <span className={`rounded-full px-3 py-1 text-xs font-extrabold ${STATUS_STYLE[pv.qa.overall]}`}>QA: {L(STATUS_AR[pv.qa.overall], pv.qa.overall)}</span>
      </div>
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">{([['design', 'محرر الجهات', 'Front / Back Editor'], ['mockup', 'استوديو المعاينة', 'Mockup Studio'], ['prepress', 'ما قبل الطباعة', 'Prepress Center'], ['qa', 'الجودة والاعتماد', 'Quality Control'], ['ad', 'الإعلان', 'Social Advertising'], ['export', 'التصدير', 'Export Center'], ['history', 'السجل', 'Project History']] as const).map(([k, ar, en]) => <button key={k} type="button" onClick={() => setSub(k)} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${sub === k ? 'bg-slate-900 text-white' : 'border bg-white'}`}>{L(ar, en)}</button>)}</div>

      {(sub === 'design' || sub === 'prepress') && cur && (
        <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
          <div className="space-y-2 rounded-2xl border bg-white p-3">
            {pv.pages.length > 1 && <div className="flex flex-wrap gap-1.5">{pv.pages.map((pg, i) => <button key={i} type="button" onClick={() => setPage(i)} className={`rounded-full px-3 py-1 text-xs font-bold ${page === i ? 'bg-indigo-700 text-white' : 'border'}`}>{pg.label}</button>)}</div>}
            <div className="relative overflow-hidden rounded-lg bg-slate-200 p-2">
              <div className="relative mx-auto" style={{ maxWidth: Math.min(900, cur.widthPx * 2), aspectRatio: `${cur.widthPx} / ${cur.heightPx}` }}>
                <img src={`/api/media/${cur.key}?v=${cur.v}`} alt={cur.label} className="block h-full w-full" />
                {guides && <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
                  {cur.bleedMm > 0 && (() => { const b = (cur.bleedMm * cur.dpi) / 25.4; return <rect x={b * kx} y={b * ky} width={100 - 2 * b * kx} height={100 - 2 * b * ky} fill="none" stroke="#ef4444" strokeWidth="0.3" vectorEffect="non-scaling-stroke" />; })()}
                  {cur.safe.map((s, i) => <rect key={i} x={s.x * kx} y={s.y * ky} width={s.w * kx} height={s.h * ky} fill="none" stroke="#10b981" strokeDasharray="1 1" strokeWidth="0.3" vectorEffect="non-scaling-stroke" />)}
                  {cur.folds.map((f, i) => { const x = ((f * cur.dpi) / 25.4) * kx; return <line key={i} x1={x} y1={0} x2={x} y2={100} stroke="#2563eb" strokeDasharray="2 1" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />; })}
                  {cur.hidden.map((h, i) => <rect key={i} x={h.rect.x * kx} y={h.rect.y * ky} width={h.rect.w * kx} height={h.rect.h * ky} fill="#f59e0b" fillOpacity="0.25" />)}
                </svg>}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
              <label className="flex items-center gap-1"><input type="checkbox" checked={guides} onChange={(e) => setGuides(e.target.checked)} />{L('إظهار الأدلة', 'Show guides')}</label>
              <span><span className="text-red-500">■</span> {L('خط القص', 'trim')} · <span className="text-emerald-600">■</span> {L('مساحة الأمان', 'safe')} · <span className="text-blue-600">■</span> {L('الطي', 'fold')} · <span className="text-amber-500">■</span> {L('منطقة مخفية', 'hidden')}</span>
            </div>
            {cur.note && <p className="text-xs text-slate-600">ℹ️ {cur.note === 'preview_only' ? L('معاينة فقط — بانتظار Dieline المورد', 'Preview only — waiting for the supplier dieline') : cur.note === 'mirrored' ? L('نسخة معكوسة للإنتاج', 'Mirrored production copy') : cur.note}</p>}
          </div>
          {sub === 'design' ? (
            <div className="space-y-3">
              <div className="rounded-2xl border bg-white p-3 text-sm">
                <div className="mb-2 font-extrabold">{L('الاتجاه الإبداعي', 'Creative direction')}</div>
                <div className="space-y-2">{pv.concepts.map((c) => <ConceptCard key={c.key} c={c} best={false} active={pv.concept === c.key} L={L} onPick={() => patch({ conceptKey: c.key, note: `الاتجاه ${c.key}` }, L('تغيير الاتجاه', 'Changing direction'))} />)}</div>
              </div>
              <div className="rounded-2xl border bg-white p-3 text-sm">
                <div className="mb-2 font-extrabold">🎨 {L('صورة الذكاء الاصطناعي', 'AI picture')}</div>
                <p className="text-[11px] text-slate-500">{L('مشهد حسب النشاط والاتجاه — بدون نصوص أو شعارات داخله. لا يُعاد توليد بقية التصميم.', 'A scene for the activity — no text or logos inside. The rest of the design is kept.')}</p>
                {plan?.areaMm && <ResolutionInfo plan={plan} L={L} />}
                {plan && (plan.live ? <button type="button" disabled={busy} onClick={() => act('image', L('يرسم الصورة…', 'Painting…'), L('أُضيفت الصورة ✓', 'Picture added ✓'))} className="mt-2 w-full rounded-lg bg-indigo-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{plan.done ? L('صورة أخرى', 'Another picture') : L('إنشاء الصورة', 'Generate')} (~${plan.costUsd})</button> : <p className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-900">{L('يحتاج مفتاح OpenAI — يظهر مكان الصورة في المعاينة فقط.', 'Needs an OpenAI key — the picture area shows in the preview only.')}</p>)}
                {plan?.current && plan.current.verdict !== 'ok' && <button type="button" disabled={busy} onClick={() => act('upscale', L('تكبير الصورة…', 'Upscaling…'), L('كُبّرت الصورة — البكسلات أنعم (لا تفاصيل جديدة) ✓', 'Upscaled ✓'))} className="mt-2 w-full rounded-lg border border-indigo-300 px-3 py-2 text-xs font-bold text-indigo-800">{L('تكبير احترافي لتنعيم البكسلات', 'Professional upscale (smoother pixels)')}{plan.current.upscale > 1 ? ` (${L('الحالي', 'now')} ×${plan.current.upscale})` : ''}</button>}
                <label className="mt-2 block text-xs font-bold">{L('أو ارفع صورة عالية الدقة (تصوير حقيقي)', 'Or upload a high-resolution photo')}{plan?.needPx && <span className="font-normal text-slate-500"> — {L('المطلوب لهذه المساحة', 'needed here')} <span dir="ltr">{plan.needPx.w}×{plan.needPx.h} px</span></span>}<input type="file" accept="image/jpeg,image/png,image/webp,image/tiff" className="mt-1 block w-full text-xs" onChange={(e) => e.target.files?.[0] && upload('hero', e.target.files[0])} /></label>
              </div>
              <div className="rounded-2xl border bg-white p-3 text-sm">
                <div className="mb-2 font-extrabold">{L('الشعار والملفات', 'Logo & files')}</div>
                <label className="block text-xs font-bold">{L('شعار العميل (الملف الأصلي)', 'Client logo (original file)')}<input type="file" accept="image/png,image/jpeg,image/svg+xml" className="mt-1 block w-full text-xs" onChange={(e) => e.target.files?.[0] && upload('logo', e.target.files[0])} /></label>
                {p.brief.logoKey && <p className="mt-1 text-[11px] text-emerald-700">✓ {L('مرفوع — يوضع كما هو بدون إعادة توليد', 'Uploaded — placed as-is, never regenerated')}</p>}
                {pv.analysis.product.family === 'packaging' && <label className="mt-2 block text-xs font-bold">Dieline {L('من المورد (SVG)', 'from the supplier (SVG)')}<input type="file" accept=".svg,image/svg+xml" className="mt-1 block w-full text-xs" onChange={(e) => e.target.files?.[0] && upload('dieline', e.target.files[0])} /></label>}
                {pv.analysis.product.family === 'packaging' && !p.brief.dieline && <p className="mt-1 text-[11px] text-slate-500">{L('صدّر القالب من Illustrator/Corel بصيغة SVG مسطّحة: خط القص أحمر/أسود متصل أو طبقة «Cut»، والثني منقّط أو طبقة «Crease».', 'Export a flattened SVG: solid red/black or a «Cut» layer for the knife, dashed or a «Crease» layer for folds.')}</p>}
                {p.brief.dieline && <div className="mt-2 space-y-1 text-[11px]"><p className="text-emerald-700">✓ Dieline: <span dir="ltr">{p.brief.dieline.wMm}×{p.brief.dieline.hMm} mm</span> · {p.brief.dieline.panels.length} {L('وجه', 'panels')} · {p.brief.dieline.fold.length} {L('خط ثني', 'creases')}</p>
                  {p.brief.dieline.panels.length > 1 && <label className="block font-bold">{L('الوجه الرئيسي للتصميم', 'Main (front) panel')}<select className="input mt-1 text-xs" value={p.brief.frontPanel ?? 0} onChange={(e) => patch({ brief: { frontPanel: Number(e.target.value) }, note: 'تغيير الوجه الرئيسي' }, L('تغيير الوجه', 'Changing panel'))}>{p.brief.dieline.panels.map((pn, i) => <option key={i} value={i}>{i + 1}: {Math.round(pn.w)}×{Math.round(pn.h)} {L('مم', 'mm')}</option>)}</select></label>}
                  {p.brief.dieline.warnings.map((w, i) => <p key={i} className="text-amber-700">⚠ {w}</p>)}</div>}
              </div>
              {texts && <div className="rounded-2xl border bg-white p-3 text-sm">
                <div className="mb-2 font-extrabold">{L('تعديل النصوص', 'Edit texts')}</div>
                <div className="space-y-2">{(['headline', 'subline', 'name', 'role', 'phone', 'email', 'website', 'address', 'cta'] as const).map((k) => <input key={k} className="input text-xs" value={texts[k] ?? ''} placeholder={k} onChange={(e) => setTexts({ ...texts, [k]: e.target.value })} />)}
                  <textarea className="input text-xs" rows={3} value={texts.extra ?? ''} placeholder={L('نقاط (سطر لكل نقطة)', 'Points')} onChange={(e) => setTexts({ ...texts, extra: e.target.value })} />
                  <button type="button" disabled={busy} className="w-full rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white" onClick={() => patch({ brief: { texts: { ...texts, extra: (texts.extra ?? '').split('\n').map((s) => s.trim()).filter(Boolean) } }, note: 'تعديل النصوص' }, L('حفظ', 'Saving'))}>{L('حفظ وتحديث المعاينة', 'Save & refresh')}</button></div>
              </div>}
              <div className="flex gap-2"><button type="button" disabled={busy} onClick={() => act('undo', L('تراجع…', 'Undo…'), L('رجعنا للنسخة السابقة ✓', 'Reverted ✓'))} className="flex-1 rounded-lg border px-3 py-2 text-xs font-bold">↶ {L('تراجع', 'Undo')}</button>
                <button type="button" disabled={busy || approved} onClick={() => act('approve', L('اعتماد…', 'Approving…'), L('اعتُمد التصميم — التعديل بعده يلغي الاعتماد ✓', 'Approved ✓'))} className="flex-1 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:bg-emerald-200">{approved ? L('معتمد ✓', 'Approved ✓') : L('اعتماد التصميم', 'Approve design')}</button></div>
            </div>
          ) : (
            <div className="space-y-2 rounded-2xl border bg-white p-3 text-xs">
              <div className="font-extrabold">{L('مركز ما قبل الطباعة', 'Prepress Center')}</div>
              <dl className="grid grid-cols-2 gap-1">
                <dt className="text-slate-500">{L('الوسيط (مع النزيف)', 'Media incl. bleed')}</dt><dd dir="ltr">{(cur.trimMm.w + 2 * cur.bleedMm).toFixed(1)}×{(cur.trimMm.h + 2 * cur.bleedMm).toFixed(1)} mm</dd>
                <dt className="text-slate-500">{L('المقاس النهائي', 'Trim')}</dt><dd dir="ltr">{cur.trimMm.w}×{cur.trimMm.h} mm</dd>
                <dt className="text-slate-500">{L('نزيف / أمان', 'Bleed / safe')}</dt><dd dir="ltr">{cur.bleedMm} / {pv.analysis.safeMm} mm</dd>
                <dt className="text-slate-500">{L('الدقة المستهدفة', 'Target PPI')}</dt><dd dir="ltr">{pv.analysis.targetPpi}</dd>
                <dt className="text-slate-500">{L('مسار القص', 'Cut path')}</dt><dd>{cur.cut ? L('Vector مستقل (CutContour)', 'separate vector (CutContour)') : '—'}{cur.kissCut ? ` + ${cur.kissCut} Kiss-Cut` : ''}</dd>
                <dt className="text-slate-500">{L('خطوط الطي', 'Folds')}</dt><dd dir="ltr">{cur.folds.length ? cur.folds.map((f) => `${f} mm`).join(' · ') : '—'}</dd>
                <dt className="text-slate-500">{L('المناطق المخفية', 'Hidden zones')}</dt><dd>{cur.hidden.map((h) => h.label).join('، ') || '—'}</dd>
                <dt className="text-slate-500">{L('الألوان', 'Colour')}</dt><dd>{L('معاينة RGB · ملف الإنتاج CMYK', 'RGB preview · CMYK production')}</dd>
              </dl>
              {pv.analysis.blockers.length > 0 && <List cls="bg-red-50 text-red-800" title={L('يمنع الإنتاج', 'Blocks production')} items={pv.analysis.blockers} />}
              {pv.analysis.warnings.length > 0 && <List cls="bg-amber-50 text-amber-900" title={L('تنبيهات', 'Warnings')} items={pv.analysis.warnings} />}
              <List cls="bg-slate-50 text-slate-700" title={L('قواعد هذا المنتج', 'Product rules')} items={FAMILIES[pv.analysis.product.family].rules} />
            </div>
          )}
        </div>
      )}

      {sub === 'mockup' && <div className="space-y-2 rounded-2xl border bg-white p-3">
        <button type="button" disabled={busy} onClick={() => act('mockup', L('بناء المعاينة الواقعية…', 'Building mockup…'), L('جاهزة ✓', 'Ready ✓'))} className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-bold text-white">{p.mockupKey ? L('تحديث المعاينة الواقعية', 'Refresh mockup') : L('إنشاء معاينة واقعية', 'Create mockup')}</button>
        {p.mockupKey && <img src={`/api/media/${p.mockupKey}`} alt="mockup" className="w-full rounded-xl" />}
        <p className="text-[11px] text-slate-500">{L('تُبنى من بكسلات التصميم نفسه (لا يعيد الذكاء الاصطناعي رسمه) — للعرض فقط وليست ملف إنتاج.', 'Built from the design’s own pixels — display only, not a production file.')}</p>
      </div>}

      {sub === 'qa' && <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{Object.entries(pv.qa.levels).map(([lv, st]) => <div key={lv} className="rounded-xl border bg-white p-2"><div className="text-xs text-slate-500">{L(LEVEL_AR[lv][0], LEVEL_AR[lv][1])}</div><span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-extrabold ${STATUS_STYLE[st]}`}>{L(STATUS_AR[st], st)}</span></div>)}</div>
        <ul className="divide-y rounded-2xl border bg-white">{pv.qa.checks.map((c, i) => <li key={i} className="flex items-start justify-between gap-2 p-2 text-xs"><div className="min-w-0"><div className="font-bold">{c.label}</div>{c.detail && <div className="text-slate-500">{c.detail}</div>}</div><span className={`shrink-0 rounded-full px-2 py-0.5 font-bold ${STATUS_STYLE[c.status]}`}>{L(STATUS_AR[c.status], c.status)}</span></li>)}</ul>
        <p className="text-[11px] text-slate-500">{L('«ناجح» فقط لما فُحص فعليًا. «جاهز للإنتاج» يظهر بعد الاعتماد وإنشاء الملفات وفتحها وبدون أي «يحتاج تعديل» أو «موقوف».', 'PASS only for what was really checked.')}</p>
      </div>}

      {sub === 'export' && <div className="space-y-2 rounded-2xl border bg-white p-3">
        {!approved && <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">{L('اعتمد التصميم أولًا — الملفات النهائية تُنشأ من النسخة المعتمدة فقط.', 'Approve the design first.')}</p>}
        <button type="button" disabled={busy || !approved} onClick={() => act('export', L('تجهيز ملفات الإنتاج وفحصها…', 'Preparing production files…'), L('الملفات جاهزة ✓', 'Files ready ✓'))} className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-bold text-white disabled:bg-slate-300">{L('فحص جودة الطباعة وتجهيز الملفات النهائية', 'Print QA & final files')}</button>
        {p.exports?.files && <ul className="divide-y rounded-xl border">{p.exports.files.map((f) => <li key={f.key} className="flex items-center justify-between gap-2 p-2 text-xs"><span className="min-w-0 flex-1 truncate"><b className="uppercase">{f.kind}</b> · {f.name}{f.note ? <span className="text-slate-500"> — {f.note}</span> : null}</span><a className="shrink-0 rounded-lg bg-slate-900 px-3 py-1 font-bold text-white" href={`/api/media/${f.key}`} download={f.name}>{L('تنزيل', 'Download')}</a></li>)}</ul>}
        {pv.qa.productionReady ? <p className="rounded bg-emerald-50 p-2 text-xs font-bold text-emerald-800">✓ {L('جاهز للإنتاج حسب الفحوص المنفذة', 'Production-ready per the checks run')}</p> : approved && p.exports && <p className="rounded bg-slate-50 p-2 text-xs text-slate-700">{L('الملفات أُنشئت، لكن توجد فحوص تحتاج مراجعة (انظر الجودة).', 'Files created; some checks need attention.')}</p>}
      </div>}

      {sub === 'ad' && <AdPanel L={L} accounts={accounts} approved={approved} busy={busy} onCreate={(body) => act('ad', L('تجهيز الإعلان…', 'Preparing the ad…'), L('أُرسل الإعلان لطابور الموافقات ✓', 'Sent to approvals ✓'), body)} />}

      {sub === 'history' && <div className="space-y-2 rounded-2xl border bg-white p-3 text-xs">
        <ul className="divide-y">{[...(p.versions ?? [])].reverse().map((v, i) => <li key={i} className="flex justify-between gap-2 py-1.5"><span>{v.note}</span><span className="text-slate-400" dir="ltr">{fmtDate(v.at)}</span></li>)}</ul>
        {!(p.versions ?? []).length && <p className="text-slate-500">{L('لا توجد نسخ سابقة.', 'No previous versions.')}</p>}
        <button type="button" className="rounded-lg border border-red-300 px-3 py-1.5 font-bold text-red-700" onClick={async () => { if (!confirm(L('حذف المشروع وملفاته؟', 'Delete project and files?'))) return; const r = await run(L('حذف…', 'Deleting…'), () => call(`/api/print/projects/${id}`, { method: 'DELETE' })); if (r) onDeleted(); }}>{L('حذف المشروع', 'Delete project')}</button>
      </div>}
    </section>
  );
}

function AdPanel({ L, accounts, approved, busy, onCreate }: { L: (a: string, e: string) => string; accounts: Account[]; approved: boolean; busy: boolean; onCreate: (b: unknown) => void }) {
  const [sel, setSel] = useState<string[]>([]); const [format, setFormat] = useState('IMAGE_FEED'); const [consent, setConsent] = useState(false); const [note, setNote] = useState('');
  return (
    <div className="space-y-2 rounded-2xl border bg-white p-3 text-sm">
      <p className="text-xs text-slate-600">{L('إعلان منفصل لمطبعة إبداع المستقبل من التصميم المعتمد: الشعار الرسمي من الملف الأصلي + رقما فرعي سار وسلماباد + كابشن. ينتظر موافقتك في طابور الموافقات — لا نشر تلقائي، ولا وعود بالأسعار أو التسليم.', 'A separate ad for the printer from the approved design — waits in the approvals queue.')}</p>
      {!approved && <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">{L('اعتمد التصميم أولًا.', 'Approve the design first.')}</p>}
      <div className="flex flex-wrap gap-1.5">{accounts.map((a) => <button key={a.id} type="button" onClick={() => setSel(sel.includes(a.id) ? sel.filter((x) => x !== a.id) : [...sel, a.id])} className={`rounded-full border px-3 py-1 text-xs font-bold ${sel.includes(a.id) ? 'bg-indigo-700 text-white' : 'bg-white'}`}>{a.name}</button>)}</div>
      <div className="flex flex-wrap gap-2">{([['IMAGE_FEED', 'منشور', 'Post'], ['IMAGE_STORY', 'ستوري', 'Story'], ['IMAGE_SQUARE', 'مربع', 'Square']] as const).map(([v, ar, en]) => <button key={v} type="button" onClick={() => setFormat(v)} className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${format === v ? 'bg-slate-900 text-white' : 'bg-white'}`}>{L(ar, en)}</button>)}</div>
      <input className="input text-xs" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder={L('ملاحظة للكابشن (اختياري)', 'Caption note (optional)')} />
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />{L('العميل وافق على ذكر اسمه في الإعلان', 'Client agreed to be named')}</label>
      <button type="button" disabled={busy || !approved || !sel.length} onClick={() => onCreate({ accountIds: sel, format, clientConsent: consent, note: note || undefined })} className="w-full rounded-lg bg-gradient-to-l from-pink-600 to-amber-500 px-3 py-2 text-sm font-extrabold text-white disabled:opacity-40">{L('إنشاء إعلان للمنتج', 'Create product ad')}</button>
    </div>
  );
}

function BrandPanel({ L, shop }: { L: (a: string, e: string) => string; shop: { logo: boolean; phones: { name: string; phone: string }[] } }) {
  return (
    <section className="space-y-3 rounded-2xl border bg-white p-4 text-sm">
      <div className="font-extrabold">{L('هوية مطبعة إبداع المستقبل (للإعلانات فقط)', 'Future Creative identity (ads only)')}</div>
      <ul className="space-y-1 text-xs">
        <li>{shop.logo ? '✓' : '✗'} {L('الشعار الرسمي من الملف الأصلي المرفوع (لا يُعاد توليده ولا تُحرّف ألوانه أو نسبه)', 'Official logo from the uploaded original file')}</li>
        {shop.phones.map((p) => <li key={p.phone}>☎ {p.name}: <span dir="ltr">{p.phone}</span></li>)}
      </ul>
      {!shop.logo && <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">{L('ارفع الشعار الأصلي من «الحسابات ← الهوية» قبل إنشاء الإعلانات.', 'Upload the original logo first.')}</p>}
      <List cls="bg-slate-50 text-slate-700" title={L('قواعد الفصل', 'Separation rules')} items={[L('تصميم منتج العميل لا يحمل شعار المطبعة أو أرقامها إلا بموافقة العميل.', 'Client products never carry the printer identity without consent.'), L('الإعلان الخاص بالمطبعة يُنشأ منفصلًا من التصميم المعتمد.', 'The printer ad is created separately from the approved design.'), L('شعار العميل يُستخدم من ملفه الأصلي فقط.', 'Client logos are used from their original file only.')]} />
    </section>
  );
}

/** resolution at the FINAL size, before paying: AI picture vs the target and vs what the eye can resolve at the viewing distance */
function ResolutionInfo({ plan, L }: { plan: ImagePlan; L: (a: string, e: string) => string }) {
  const V: Record<Verdict, [string, string, string]> = { ok: ['ممتازة', 'good', 'bg-emerald-100 text-emerald-800'], acceptable: ['مقبولة لمسافة المشاهدة', 'acceptable for the distance', 'bg-amber-100 text-amber-800'], low: ['منخفضة', 'low', 'bg-red-100 text-red-800'] };
  const row = (label: string, v: { px: string; ppi: number; verdict: Verdict }) => <div className="flex items-center justify-between gap-2"><span>{label} <span className="text-slate-400" dir="ltr">({v.px})</span></span><span className={`rounded-full px-2 py-0.5 font-bold ${V[v.verdict][2]}`} dir="ltr">{v.ppi} PPI · {L(V[v.verdict][0], V[v.verdict][1])}</span></div>;
  return (
    <div className="mt-2 space-y-1 rounded-lg bg-slate-50 p-2 text-[11px]">
      <div className="font-bold">{L('الدقة بالمقاس النهائي', 'Resolution at final size')} — <span dir="ltr">{plan.areaMm!.w}×{plan.areaMm!.h} mm</span></div>
      <div className="text-slate-500">{L('المستهدف', 'Target')} {plan.target} PPI{plan.eye ? ` · ${L('حد رؤية العين عند', 'eye limit at')} ${plan.viewM} ${L('م', 'm')}: ${plan.eye} PPI` : ''}</div>
      {plan.ai && row(L('صورة الذكاء الاصطناعي', 'AI picture'), plan.ai)}
      {plan.current && row(plan.current.source === 'upload' ? L('الصورة المرفوعة', 'Uploaded photo') : L('الصورة الحالية', 'Current picture'), plan.current)}
      {plan.current && plan.current.upscale > 1 && <div className="text-slate-500">{L(`مكبّرة ×${plan.current.upscale} — الفحص يقيس الصورة الأصلية`, `Upscaled ×${plan.current.upscale} — QA measures the original`)}</div>}
      {plan.ai?.verdict === 'low' && <div className="text-red-700">{L('صورة الذكاء الاصطناعي ستظهر مكسّرة بهذا المقاس — الأفضل صورة حقيقية عالية الدقة أو تصغير مساحة الصورة.', 'An AI picture will look pixelated at this size — use a real high-res photo or a smaller picture area.')}</div>}
    </div>
  );
}

