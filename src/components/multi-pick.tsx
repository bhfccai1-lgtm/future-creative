'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, Shuffle, X } from 'lucide-react';

export type PickOpt = { value: string; label: string; hint?: string };

/**
 * Multi-choice field (mobile bottom sheet / desktop popover). Empty = automatic; several values = the system picks ONE of
 * them at random for each design.
 */
export function MultiPick({ label, options, value, onChange, autoLabel, max }: {
  label: string; options: PickOpt[]; value: string[]; onChange: (v: string[]) => void; autoLabel: string; max?: number;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const out = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', esc); document.addEventListener('mousedown', out);
    return () => { document.removeEventListener('keydown', esc); document.removeEventListener('mousedown', out); };
  }, [open]);
  const shown = useMemo(() => { const t = q.trim(); return t ? options.filter((o) => o.label.includes(t) || o.label.toLowerCase().includes(t.toLowerCase())) : options; }, [q, options]);
  const sel = new Set(value);
  const toggle = (v: string) => onChange(sel.has(v) ? value.filter((x) => x !== v) : max && value.length >= max ? value : [...value, v]);
  const labels = value.map((v) => options.find((o) => o.value === v)?.label).filter(Boolean) as string[];
  return (
    <div className="relative" ref={ref}>
      <label className="label">{label}</label>
      <button type="button" className="input flex min-h-[2.75rem] w-full items-center justify-between gap-2 text-right" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="min-w-0 flex-1 truncate">
          {labels.length === 0 ? <span className="text-slate-600">{autoLabel}</span>
            : labels.length === 1 ? labels[0]
            : <span className="inline-flex items-center gap-1"><Shuffle size={14} className="shrink-0 text-gold-600" aria-hidden /><b>{labels.length}</b> مختارة — عشوائي بينها: {labels.join('، ')}</span>}
        </span>
        <ChevronDown size={16} className="shrink-0 text-slate-500" aria-hidden />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-navy-900/40 md:hidden" aria-hidden onClick={() => setOpen(false)} />
          <div role="listbox" aria-multiselectable aria-label={label}
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[80vh] flex-col rounded-t-3xl bg-white shadow-2xl md:absolute md:inset-x-0 md:bottom-auto md:top-full md:mt-1 md:max-h-96 md:rounded-2xl md:border">
            <div className="flex items-center justify-between gap-2 border-b p-3">
              <b className="text-navy-900">{label}</b>
              <div className="flex items-center gap-3 text-xs">
                {value.length > 0 && <button type="button" className="font-bold text-slate-600 underline" onClick={() => onChange([])}>مسح ({value.length})</button>}
                <button type="button" className="rounded-full bg-navy-800 px-4 py-1.5 font-bold text-white" onClick={() => setOpen(false)}>تم</button>
              </div>
            </div>
            <p className="flex items-center gap-1.5 bg-gold-300/15 px-3 py-2 text-xs text-navy-800"><Shuffle size={13} aria-hidden /> اختر أكثر من واحد ← يختار النظام واحدًا منها عشوائيًا في كل تصميم. بدون اختيار = {autoLabel}.</p>
            {options.length > 10 && (
              <div className="relative border-b p-2">
                <Search size={15} className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
                <input className="input pr-9" placeholder="ابحث…" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`بحث في ${label}`} />
                {q && <button type="button" className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" onClick={() => setQ('')} aria-label="مسح البحث"><X size={15} /></button>}
              </div>
            )}
            <ul className="flex-1 overflow-y-auto overscroll-contain py-1">
              {shown.map((o) => {
                const on = sel.has(o.value);
                return (
                  <li key={o.value}>
                    <button type="button" role="option" aria-selected={on} onClick={() => toggle(o.value)}
                      className={`flex w-full items-center gap-3 px-4 py-3 text-right active:bg-slate-100 ${on ? 'bg-gold-300/10' : ''}`}>
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition-colors ${on ? 'border-gold-500 bg-gold-500 text-white' : 'border-slate-300'}`} aria-hidden>{on && <Check size={15} strokeWidth={3} />}</span>
                      <span className="flex-1">{o.label}</span>{o.hint && <span className="text-xs text-slate-500">{o.hint}</span>}
                    </button>
                  </li>
                );
              })}
              {!shown.length && <li className="p-4 text-center text-sm text-slate-500">لا نتائج</li>}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
