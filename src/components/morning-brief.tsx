'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiCall } from '@/lib/client/api';
import type { Brief } from '@/lib/ops/briefing';
import { toast } from './toaster';

type Cfg = { enabled: boolean; aiWrite: boolean; whatsapp: boolean };

/** «☀️ موجز الصباح الذكي» — the three things worth doing first today, with links */
export function MorningBrief({ brief, cfg, canControl }: { brief: Brief | null; cfg: Cfg; canControl: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [c, setC] = useState(cfg);
  const [open, setOpen] = useState(false);
  const refresh = async () => { setBusy(true); try { const r = await apiCall<{ message: string }>('/api/briefing', { body: {} }); toast(r.message); router.refresh(); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); } };
  const save = async (next: Cfg) => { setC(next); try { await apiCall('/api/briefing', { method: 'PUT', body: next }); toast('حُفظ'); } catch (e) { toast((e as Error).message, 'error'); } };
  const at = brief ? new Date(brief.at).toLocaleString('en-GB', { timeZone: 'Asia/Bahrain', dateStyle: 'short', timeStyle: 'short' }) : null;
  const n = brief?.numbers;
  return (
    <section className="card mb-4 border-gold-500/40 bg-gradient-to-l from-gold-300/10 to-white p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-extrabold text-navy-900">☀️ موجز الصباح الذكي</h2>
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          {at && <span>{at}{brief?.source === 'ai' ? ' · صاغه الذكاء الاصطناعي' : ''}</span>}
          <button type="button" disabled={busy} onClick={refresh} className="rounded-md border border-slate-300 bg-white px-2 py-0.5 font-bold text-navy-800">{busy ? '…' : 'حدّث الآن'}</button>
        </div>
      </div>
      {!brief && <p className="text-sm text-slate-600">يُجهَّز كل صباح الساعة ٧:٣٥ — اضغط «حدّث الآن» لتراه الآن.</p>}
      {brief && (
        <>
          {brief.actions.length ? (
            <ol className="space-y-1.5">{brief.actions.map((a, i) => (
              <li key={a.id} className="flex items-start gap-2 text-sm">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-navy-800 text-[11px] font-bold text-white">{i + 1}</span>
                <Link href={a.link} className="min-w-0 flex-1 font-bold text-navy-900 hover:underline">{a.text}</Link>
              </li>
            ))}</ol>
          ) : <p className="text-sm font-bold text-emerald-700">لا شيء عاجل اليوم 👌</p>}
          {n && (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600">
              <span>موافقات: <b>{n.pendingApprovals}</b></span>
              <span>عملاء ساخنون: <b>{n.hotLeads}</b></span>
              <span>متابعات متأخرة: <b>{n.overdueFollowUps}</b></span>
              {n.trendIdeas > 0 && <span>أفكار ترند: <b>{n.trendIdeas}</b></span>}
              {brief.bestPost && <span>أفضل منشور: <b>{brief.bestPost.views}</b> مشاهدة ({brief.bestPost.account})</span>}
              <span>الذكاء الاصطناعي هذا الشهر: <b>${n.aiSpendUsd}</b>{n.aiBudgetUsd ? ` من $${n.aiBudgetUsd}` : ''}</span>
            </div>
          )}
          <button type="button" className="mt-2 text-[11px] font-bold text-gold-600 underline" onClick={() => setOpen(!open)}>{open ? 'إخفاء نص الموجز' : 'نص الموجز كاملًا'}</button>
          {open && <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-white p-2 font-sans text-xs leading-6 text-slate-700">{brief.text}</pre>}
        </>
      )}
      {canControl && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-[11px] text-slate-600">
          <label className="flex items-center gap-1"><input type="checkbox" checked={c.enabled} onChange={(e) => save({ ...c, enabled: e.target.checked })} />موجز يومي (مجاني)</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={c.aiWrite} disabled={!c.enabled} onChange={(e) => save({ ...c, aiWrite: e.target.checked })} />صياغة بالذكاء الاصطناعي (طلب نصي صغير يوميًا)</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={c.whatsapp} disabled={!c.enabled} onChange={(e) => save({ ...c, whatsapp: e.target.checked })} />أرسله لرقمي على واتساب (واتساب الذكي)</label>
        </div>
      )}
    </section>
  );
}
