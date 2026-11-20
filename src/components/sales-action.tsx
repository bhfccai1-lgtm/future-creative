'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from './toaster';
import { apiCall } from '@/lib/client/api';

/** The next sales step for a customer: ready message → open WhatsApp (a person presses send) or copy; the step is logged. */
export function SalesAction({ leadId, scriptKey, label, due, text, wa }: { leadId: string; scriptKey: string; label: string; due: boolean; text: string; wa: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState(text);
  const [pending, start] = useTransition();
  const [drafting, setDrafting] = useState(false);
  const log = () => start(async () => { try { const r = await apiCall<{ message: string }>(`/api/leads/${leadId}/touch`, { body: { key: scriptKey } }); toast(r.message); router.refresh(); } catch (e) { toast((e as Error).message, 'error'); } });
  const link = wa ? wa.replace(/text=[^&]*/, `text=${encodeURIComponent(msg)}`) : null;
  return (
    <div className={`mt-2 rounded-xl border p-2 ${due ? 'border-emerald-300 bg-emerald-50' : 'bg-slate-50'}`}>
      <button type="button" className="flex w-full items-center justify-between gap-2 text-right text-xs font-bold text-navy-900" onClick={() => setOpen(!open)}>
        <span>➡️ الخطوة التالية: {label}{due ? '' : ' (لاحقًا)'}</span><span className="text-gold-600">{open ? 'إخفاء' : 'الرسالة ▾'}</span>
      </button>
      {open && <textarea className="input mt-2 text-sm" rows={5} value={msg} onChange={(e) => setMsg(e.target.value)} />}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {link
          ? <a href={link} target="_blank" rel="noreferrer" onClick={log} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white">📲 إرسال عبر واتساب</a>
          : <span className="text-[11px] text-slate-500">لا يوجد رقم واتساب — انسخ الرسالة وأرسلها من حيث تواصل العميل.</span>}
        <button type="button" disabled={drafting} className="rounded-lg border border-gold-500 bg-white px-3 py-1.5 text-xs font-bold text-navy-800" onClick={async () => {
          setDrafting(true);
          try { const r = await apiCall<{ text: string; message: string }>(`/api/leads/${leadId}/draft`, { body: {} }); setMsg(r.text); setOpen(true); toast(r.message); } catch (e) { toast((e as Error).message, 'error'); } finally { setDrafting(false); }
        }}>{drafting ? '…' : '✨ صياغة ذكية'}</button>
        <button type="button" disabled={pending} className="rounded-lg border bg-white px-3 py-1.5 text-xs font-bold text-navy-800" onClick={async () => { try { await navigator.clipboard.writeText(msg); } catch { /* clipboard blocked */ } toast('نُسخت الرسالة'); log(); }}>📋 نسخ وتسجيل</button>
      </div>
    </div>
  );
}
