'use client';
import { useState } from 'react';
import { csrfToken } from '@/lib/client/api';

/** the client's approve / request-changes form on the public proof page */
export function ProofDecision({ token, initial, disabled }: { token: string; initial: { status: string; name: string; note: string; at: string } | null; disabled: boolean }) {
  const [d, setD] = useState(initial);
  const [name, setName] = useState(''); const [note, setNote] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const send = async (decision: 'approve' | 'changes') => {
    setBusy(true); setMsg('');
    try {
      const r = await fetch(`/api/proof/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken() }, body: JSON.stringify({ decision, name, note: note || undefined }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message ?? 'تعذّر الإرسال');
      setD(j.decision);
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  if (d?.status === 'approved') return <div className="rounded-2xl bg-emerald-50 p-4 text-center text-sm font-bold text-emerald-800">✅ تم اعتماد التصميم باسم {d.name} — شكرًا لك، سنبدأ التجهيز للطباعة.</div>;
  return (
    <section className="space-y-2 rounded-2xl border bg-white p-4">
      {d?.status === 'changes' && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">أرسلت تعديلات سابقًا ({d.name}): {d.note} — ستصلك بروفة جديدة.</p>}
      <label className="block text-sm font-bold">اسمك<input className="mt-1 w-full rounded-lg border p-2 text-sm" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} disabled={disabled} /></label>
      <label className="block text-sm font-bold">ملاحظات / تعديلات (اختياري للاعتماد)<textarea className="mt-1 w-full rounded-lg border p-2 text-sm" rows={3} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} disabled={disabled} /></label>
      {msg && <p role="alert" className="text-sm font-bold text-red-700">{msg}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={disabled || busy || name.trim().length < 2} onClick={() => send('approve')} className="rounded-xl bg-emerald-700 p-3 text-sm font-extrabold text-white disabled:bg-slate-300">✅ أعتمد التصميم</button>
        <button type="button" disabled={disabled || busy || name.trim().length < 2 || note.trim().length < 3} onClick={() => send('changes')} className="rounded-xl border-2 border-amber-500 p-3 text-sm font-extrabold text-amber-800 disabled:border-slate-200 disabled:text-slate-400">✏️ أطلب تعديلات</button>
      </div>
      <p className="text-[11px] text-slate-500">بالضغط على «أعتمد» توافق على طباعة التصميم كما يظهر (بدون علامة البروفة).</p>
    </section>
  );
}
