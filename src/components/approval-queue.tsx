'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckSquare, ChevronLeft, ChevronRight, Eye, Square, X, Zap } from 'lucide-react';
import { apiCall } from '@/lib/client/api';
import { ActionButton } from './action-button';
import { Badge, cn } from './ui';
import { toast } from './toaster';

export type QueueItem = {
  id: string; adId: string; headline: string; caption: string | null; account: string; product: string; format: string; formatAr: string;
  img: string | null; video: string | null; slides: number; verdict: 'PASS' | 'NEEDS_REVIEW' | 'NEEDS_ASSET' | 'REJECTED'; verdictAr: string;
  reasonAr: string; reasonCode: string; note: string | null; failed: { id: string; label: string; detail?: string }[];
  publishable: boolean; qcPassed: boolean; dryRun: boolean; algo: number; rubric: number | null;
  lane: 'ready' | 'attention' | 'blocked'; quality: number | null; qualitySource: 'rubric' | 'algorithm' | null; wait: string; createdLabel: string;
};
const LANES = [
  { id: 'ready', ar: 'جاهز للنشر', hint: 'اجتاز كل الفحوص — الأعلى جودة أولًا', tone: 'emerald' },
  { id: 'attention', ar: 'يحتاج نظرتك', hint: 'ملاحظات جودة أو أصل ناقص — الأقدم أولًا', tone: 'amber' },
  { id: 'blocked', ar: 'متوقف', hint: 'تجريبي أو فشل فحص أساسي — ارفض أو أعد التوليد', tone: 'red' },
  { id: 'all', ar: 'الكل', hint: 'بترتيب الأولوية', tone: 'slate' },
] as const;
type LaneId = (typeof LANES)[number]['id'];
const qTone = (q: number | null) => (q === null ? 'slate' : q >= 85 ? 'green' : q >= 70 ? 'blue' : 'amber') as 'green' | 'blue' | 'amber' | 'slate';

/**
 * «طابور الموافقات» as a review workflow: smart lanes (ready → best quality first; attention → oldest first), filters,
 * multi-select with bulk publish / reject, and a full-screen quick review (A publish · R reject · E edit · ← → move).
 * Every decision goes through the same server checks as before; bulk publish never overrides quality.
 */
export function ApprovalQueue({ items, canPublish, totalPending }: { items: QueueItem[]; canPublish: boolean; totalPending: number }) {
  const router = useRouter();
  const counts = useMemo(() => ({ ready: items.filter((i) => i.lane === 'ready').length, attention: items.filter((i) => i.lane === 'attention').length, blocked: items.filter((i) => i.lane === 'blocked').length, all: items.length }), [items]);
  const [lane, setLane] = useState<LaneId>(counts.ready ? 'ready' : counts.attention ? 'attention' : 'all');
  const [account, setAccount] = useState('');
  const [format, setFormat] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<Set<string>>(new Set()); // decided in this session (hidden until the refresh lands)
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<number | null>(null);

  const accounts = useMemo(() => [...new Set(items.map((i) => i.account))], [items]);
  const formats = useMemo(() => [...new Map(items.map((i) => [i.format, i.formatAr])).entries()], [items]);
  const list = useMemo(() => items.filter((i) => !done.has(i.adId) && (lane === 'all' || i.lane === lane) && (!account || i.account === account) && (!format || i.format === format)), [items, done, lane, account, format]);
  const selected = list.filter((i) => sel.has(i.adId));
  const selPublishable = selected.filter((i) => i.publishable && !i.dryRun);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allSel = list.length > 0 && list.every((i) => sel.has(i.adId));

  const bulk = async (action: 'publish' | 'reject', ids: string[], note?: string) => {
    if (!ids.length) return;
    setBusy(true);
    try {
      const r = await apiCall<{ message: string; done: number }>('/api/approvals/bulk', { body: { action, ids, ...(note ? { note } : {}) } });
      toast(r.message);
      setDone((d) => new Set([...d, ...ids])); setSel(new Set());
      router.refresh();
    } catch (e) { toast((e as Error).message, 'error'); }
    setBusy(false);
  };

  // ── quick review ──
  const cur = review !== null ? list[review] : undefined;
  const close = useCallback(() => setReview(null), []);
  const decide = useCallback(async (action: 'publish' | 'reject') => {
    if (!cur || busy) return;
    if (action === 'publish' && (!cur.publishable || cur.dryRun || !canPublish)) { toast('هذا التصميم يحتاج مراجعة في بطاقته قبل النشر', 'error'); return; }
    let note: string | undefined;
    if (action === 'reject') { const v = window.prompt('سبب الرفض (اختياري — يحسّن التصاميم القادمة)'); if (v === null) return; note = v || undefined; }
    setBusy(true);
    try {
      const r = await apiCall<{ message: string }>('/api/approvals/bulk', { body: { action, ids: [cur.adId], ...(note ? { note } : {}) } });
      toast(r.message);
      setDone((d) => new Set([...d, cur.adId]));
      // the list shrinks by one: the same index now shows the next design
      if (list.length <= 1) { setReview(null); router.refresh(); } else setReview((i) => Math.min(i ?? 0, list.length - 2));
    } catch (e) { toast((e as Error).message, 'error'); }
    setBusy(false);
  }, [cur, busy, canPublish, list.length, router]);
  useEffect(() => {
    if (review === null) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') setReview((i) => Math.min((i ?? 0) + 1, list.length - 1)); // RTL: left = next
      else if (e.key === 'ArrowRight') setReview((i) => Math.max((i ?? 0) - 1, 0));
      else if (e.key.toLowerCase() === 'a' || e.key === 'ش') void decide('publish');
      else if (e.key.toLowerCase() === 'r' || e.key === 'ق') void decide('reject');
      else if ((e.key.toLowerCase() === 'e' || e.key === 'ث') && cur) router.push(`/ads/${cur.adId}`);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [review, list.length, decide, close, cur, router]);
  useEffect(() => { if (review !== null && review >= list.length) setReview(list.length ? list.length - 1 : null); }, [review, list.length]);

  return (
    <div>
      {/* lanes */}
      <div role="tablist" aria-label="مسارات المراجعة" className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {LANES.map((l) => {
          const n = counts[l.id], on = lane === l.id;
          return (
            <button key={l.id} type="button" role="tab" aria-selected={on} onClick={() => { setLane(l.id); setSel(new Set()); }}
              className={cn('rounded-xl border-2 p-3 text-right transition', on ? 'border-navy-800 bg-navy-900 text-white shadow' : 'border-slate-200 bg-white hover:border-gold-400')}>
              <div className="flex items-baseline justify-between gap-2"><b className="text-sm">{l.ar}</b>
                <span className={cn('text-2xl font-extrabold', on ? 'text-gold-300' : l.tone === 'emerald' ? 'text-emerald-600' : l.tone === 'amber' ? 'text-amber-600' : l.tone === 'red' ? 'text-red-600' : 'text-navy-900')}>{n}</span></div>
              <div className={cn('mt-0.5 text-[11px] leading-4', on ? 'text-navy-100' : 'text-slate-500')}>{l.hint}</div>
            </button>
          );
        })}
      </div>

      {/* filters + bulk bar */}
      <div className="sticky top-0 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-xl border bg-white/95 p-2 shadow-sm backdrop-blur">
        <button type="button" onClick={() => setSel(allSel ? new Set() : new Set(list.map((i) => i.adId)))} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-bold text-navy-800 hover:bg-slate-100" aria-pressed={allSel}>
          {allSel ? <CheckSquare size={18} /> : <Square size={18} />} تحديد الكل ({list.length})</button>
        <select className="input py-1.5 text-xs sm:!w-48" value={account} onChange={(e) => setAccount(e.target.value)} aria-label="الحساب"><option value="">كل الحسابات</option>{accounts.map((a) => <option key={a} value={a}>{a}</option>)}</select>
        <select className="input py-1.5 text-xs sm:!w-40" value={format} onChange={(e) => setFormat(e.target.value)} aria-label="الصيغة"><option value="">كل الصيغ</option>{formats.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <button type="button" disabled={!list.length} onClick={() => setReview(0)} className="mr-auto inline-flex items-center gap-1.5 rounded-lg bg-gold-500 px-3 py-1.5 text-sm font-extrabold text-navy-950 shadow hover:bg-gold-400 disabled:opacity-40"><Zap size={16} />مراجعة سريعة</button>
        {selected.length > 0 && (
          <div className="flex w-full flex-wrap items-center gap-2 border-t pt-2">
            <span className="text-sm font-bold text-navy-900">{selected.length} محدد</span>
            {canPublish && <button type="button" disabled={busy || !selPublishable.length} onClick={() => { if (window.confirm(`نشر ${selPublishable.length} تصميم اجتاز فحص الجودة؟ يُوزَّع بفاصل 30 دقيقة لكل حساب.${selPublishable.length < selected.length ? `\n(${selected.length - selPublishable.length} لم يجتز الفحص سيُتخطّى — انشره منفردًا بعد مراجعته)` : ''}`)) void bulk('publish', selPublishable.map((i) => i.adId)); }}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-40">✓ نشر الجاهز ({selPublishable.length})</button>}
            <button type="button" disabled={busy} onClick={() => { const v = window.prompt(`رفض ${selected.length} تصميم؟ اكتب السبب (اختياري — يحسّن التصاميم القادمة)`); if (v !== null) void bulk('reject', selected.map((i) => i.adId), v || undefined); }}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-40">✗ رفض ({selected.length})</button>
            <button type="button" onClick={() => setSel(new Set())} className="text-xs font-bold text-slate-500 underline">إلغاء التحديد</button>
          </div>
        )}
      </div>
      {totalPending > items.length && <p className="mb-3 text-xs text-slate-500">يظهر {items.length} من {totalPending} — اعتمد أو ارفض لتظهر البقية.</p>}
      {!list.length && <p className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">لا شيء هنا {lane === 'ready' ? '— لا تصاميم جاهزة الآن' : ''} 🎉</p>}

      {/* cards */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {list.map((it, idx) => (
          <article key={it.id} className={cn('overflow-hidden rounded-2xl border bg-white shadow-sm transition', sel.has(it.adId) && 'ring-2 ring-gold-400')}>
            <div className="relative bg-slate-900">
              {it.video
                ? <video className="aspect-[9/16] max-h-[52vh] w-full object-contain sm:max-h-[60vh]" src={`/api/media/${it.video}`} poster={it.img ? `/api/media/${it.img}` : undefined} controls playsInline preload="none" />
                : it.img ? <button type="button" className="block w-full" onClick={() => setReview(idx)} aria-label={`مراجعة ${it.headline}`}><img className="max-h-[52vh] w-full object-contain sm:max-h-[60vh]" src={`/api/media/${it.img}`} alt={it.headline} loading="lazy" /></button>
                : <div className="flex aspect-[4/5] items-center justify-center text-xs text-navy-100">لا توجد صورة نهائية — افتح «تعديل»</div>}
              <button type="button" onClick={() => toggle(it.adId)} aria-pressed={sel.has(it.adId)} aria-label="تحديد"
                className={cn('absolute left-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg border-2 shadow', sel.has(it.adId) ? 'border-gold-400 bg-gold-400 text-navy-950' : 'border-white/80 bg-black/40 text-white')}>
                {sel.has(it.adId) ? <CheckSquare size={18} /> : <Square size={18} />}</button>
              <div className="absolute right-2 top-2 flex flex-wrap gap-1">
                <Badge tone="navy">{it.formatAr}{it.slides ? ` · ${it.slides + 1} شرائح` : ''}</Badge>
                {it.dryRun && <Badge tone="amber">تجريبي</Badge>}
              </div>
              {it.quality !== null && <span className={cn('absolute bottom-2 left-2 rounded-full px-2.5 py-1 text-sm font-extrabold shadow', it.quality >= 85 ? 'bg-emerald-500 text-white' : it.quality >= 70 ? 'bg-sky-500 text-white' : 'bg-amber-400 text-navy-950')} title={it.qualitySource === 'rubric' ? 'مؤشر الجودة من 100' : 'مؤشر الخوارزمية'}>{it.quality}</span>}
            </div>
            <div className="p-3">
              <div className="mb-1 flex flex-wrap gap-1">
                <Badge tone={it.verdict === 'PASS' ? 'green' : it.verdict === 'REJECTED' ? 'red' : 'amber'}>الجودة: {it.verdictAr}</Badge>
                <Badge tone={it.reasonCode === 'QC_FAILED' ? 'red' : 'blue'}>{it.reasonAr}</Badge>
                <Badge tone={qTone(it.algo)}>📈 الخوارزمية {it.algo}</Badge>
                <span className="text-[11px] text-slate-500">⏱ {it.wait}</span>
              </div>
              <div className="text-base font-extrabold text-navy-900" dir="auto">{it.headline}</div>
              <div className="text-xs text-slate-500">{it.account} · {it.product} · {it.createdLabel}</div>
              {it.note && <p className="mt-1 text-xs text-slate-600">{it.note}</p>}
              {it.caption && <details className="mt-2 rounded-lg bg-slate-50 p-2 text-sm"><summary className="cursor-pointer text-xs font-bold text-navy-700">النص المرافق</summary><p className="mt-2 whitespace-pre-wrap text-slate-700" dir="auto">{it.caption}</p></details>}
              {it.failed.length > 0 && <ul className="mt-2 space-y-0.5 text-xs text-red-700">{it.failed.map((c) => <li key={c.id}>⛔ {c.label}{c.detail ? ` — ${c.detail}` : ''}</li>)}</ul>}
            </div>
            <div className="grid grid-cols-3 gap-2 border-t bg-slate-50 p-2">
              {it.publishable
                ? <ActionButton url={`/api/ads/${it.adId}/publish-now`} label="✓ نشر" variant="success" size="lg" block success="أُرسل للنشر — سيُنشر في أقرب وقت آمن" onDone={() => setDone((d) => new Set([...d, it.adId]))} />
                : !it.dryRun && canPublish ? <ActionButton url={`/api/ads/${it.adId}/publish-now`} body={{ overrideQc: true }} label="⚠ نشر الآن" variant="gold" size="lg" block success="أُرسل للنشر رغم ملاحظات الجودة — سُجّل باسمك"
                    confirm={`نشر هذا التصميم بدون اجتياز فحص الجودة؟\n\nالملاحظات:\n${it.failed.map((c) => `• ${c.label}`).join('\n') || '• يحتاج مراجعة بشرية'}\n\nتأكد بنفسك من النص والأرقام والشعار. يُسجَّل القرار باسمك.`}
                    prompt="سبب النشر رغم الملاحظات (اختياري)" promptKey="reason" onDone={() => setDone((d) => new Set([...d, it.adId]))} />
                : it.qcPassed ? <ActionButton url={`/api/ads/${it.adId}/approve`} label="✓ اعتماد" variant="success" size="lg" block success="تم اعتماد التصميم" /> : <span />}
              <Link href={`/ads/${it.adId}`} className="flex items-center justify-center rounded-lg border bg-white text-sm font-bold text-navy-800">✎ تعديل</Link>
              <ActionButton url={`/api/ads/${it.adId}/reject`} label="✗ رفض" variant="danger" size="lg" block success="تم الرفض — سنتجنّب هذا الأسلوب" prompt="سبب الرفض (اختياري — يحسّن التصاميم القادمة)" promptKey="note" onDone={() => setDone((d) => new Set([...d, it.adId]))} />
            </div>
          </article>
        ))}
      </div>

      {/* quick review overlay */}
      {cur && (
        <div role="dialog" aria-modal="true" aria-label="مراجعة سريعة" className="fixed inset-0 z-50 flex flex-col bg-navy-950 text-white">
          <div className="flex items-center gap-3 border-b border-white/10 px-4 py-2">
            <Eye size={18} className="text-gold-400" /><b className="text-sm">مراجعة سريعة</b>
            <span className="text-xs text-navy-100">{(review ?? 0) + 1} / {list.length}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-gold-400 transition-all" style={{ width: `${(((review ?? 0) + 1) / list.length) * 100}%` }} /></div>
            <span className="hidden text-[11px] text-navy-100 md:inline">A نشر · R رفض · E تعديل · ← → تنقل · Esc إغلاق</span>
            <button type="button" onClick={close} aria-label="إغلاق" className="rounded-lg p-1.5 hover:bg-white/10"><X size={20} /></button>
          </div>
          <div className="grid min-h-0 flex-1 gap-4 p-4 md:grid-cols-[minmax(0,1fr)_340px]">
            <div className="flex min-h-0 items-center justify-center gap-2">
              <button type="button" aria-label="السابق" disabled={(review ?? 0) === 0} onClick={() => setReview((i) => Math.max((i ?? 0) - 1, 0))} className="rounded-full bg-white/10 p-2 disabled:opacity-20"><ChevronRight size={22} /></button>
              <div className="flex h-full min-h-0 flex-1 items-center justify-center">
                {cur.video ? <video key={cur.adId} className="max-h-full max-w-full rounded-xl" src={`/api/media/${cur.video}`} poster={cur.img ? `/api/media/${cur.img}` : undefined} controls autoPlay muted playsInline />
                  : cur.img ? <img key={cur.adId} className="max-h-full max-w-full rounded-xl object-contain shadow-2xl" src={`/api/media/${cur.img}`} alt={cur.headline} /> : <span className="text-sm text-navy-100">لا توجد صورة</span>}
              </div>
              <button type="button" aria-label="التالي" disabled={(review ?? 0) >= list.length - 1} onClick={() => setReview((i) => Math.min((i ?? 0) + 1, list.length - 1))} className="rounded-full bg-white/10 p-2 disabled:opacity-20"><ChevronLeft size={22} /></button>
            </div>
            <aside className="flex min-h-0 flex-col gap-3 overflow-auto rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
              <div className="flex flex-wrap gap-1.5 text-xs">
                {cur.quality !== null && <span className="rounded-full bg-gold-400 px-2 py-0.5 font-extrabold text-navy-950">{cur.qualitySource === 'rubric' ? 'الجودة' : 'الخوارزمية'} {cur.quality}</span>}
                <span className={cn('rounded-full px-2 py-0.5 font-bold', cur.verdict === 'PASS' ? 'bg-emerald-500/20 text-emerald-200' : 'bg-amber-500/20 text-amber-200')}>{cur.verdictAr}</span>
                <span className="rounded-full bg-white/10 px-2 py-0.5">{cur.formatAr}</span>
                <span className="rounded-full bg-white/10 px-2 py-0.5">⏱ {cur.wait}</span>
              </div>
              <div><div className="text-lg font-extrabold leading-7" dir="auto">{cur.headline}</div><div className="text-xs text-navy-100">{cur.account} · {cur.product}</div></div>
              {cur.failed.length > 0 && <ul className="space-y-0.5 rounded-lg bg-red-500/10 p-2 text-xs text-red-200">{cur.failed.map((c) => <li key={c.id}>⛔ {c.label}{c.detail ? ` — ${c.detail}` : ''}</li>)}</ul>}
              {cur.caption && <p className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-black/20 p-2 text-sm leading-6 text-navy-50" dir="auto">{cur.caption}</p>}
              <div className="mt-auto grid grid-cols-3 gap-2">
                <button type="button" disabled={busy || !cur.publishable || cur.dryRun || !canPublish} onClick={() => void decide('publish')} className="rounded-xl bg-emerald-500 py-3 text-sm font-extrabold text-white hover:bg-emerald-600 disabled:opacity-30" title={cur.publishable ? '' : 'يحتاج مراجعة في بطاقته'}>✓ نشر <kbd className="text-[10px] opacity-70">A</kbd></button>
                <Link href={`/ads/${cur.adId}`} className="flex items-center justify-center rounded-xl bg-white/10 py-3 text-sm font-bold hover:bg-white/20">✎ تعديل</Link>
                <button type="button" disabled={busy} onClick={() => void decide('reject')} className="rounded-xl bg-red-500 py-3 text-sm font-extrabold text-white hover:bg-red-600 disabled:opacity-40">✗ رفض <kbd className="text-[10px] opacity-70">R</kbd></button>
              </div>
              {!cur.publishable && !cur.dryRun && <p className="text-[11px] text-amber-200">لم يجتز فحص الجودة كاملًا — النشر رغم الملاحظات متاح من بطاقته فقط (قرار مسجّل باسمك).</p>}
            </aside>
          </div>
        </div>
      )}
    </div>
  );
}
