'use client';
import { useEffect, useState } from 'react';
import { apiCall } from '@/lib/client/api';
import { Button } from './ui';
import type { ServerUpdateState } from '@/lib/ops/server-update';

const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('ar-BH', { timeZone: 'Asia/Bahrain', dateStyle: 'medium', timeStyle: 'short' }) : '—');

/** «تحديث الخادم» — leaves a request for the host's update agent, then follows it until the new version runs. */
export function ServerUpdateButton({ initial }: { initial: ServerUpdateState }) {
  const [s, setS] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const working = !!s.pending || s.last?.state === 'running';

  // while an update is pending/running, poll every 10 s (the web container restarts during the switch → errors are expected)
  useEffect(() => {
    if (!working) return;
    const id = setInterval(async () => {
      try {
        const n = await apiCall<ServerUpdateState>('/api/system/update');
        setS(n);
        if (n.last?.state === 'ok' && !n.pending && n.version !== initial.version) setMsg({ ok: true, t: `تم التحديث ✓ — الإصدار الآن ${n.version}. أعد تحميل الصفحة.` });
      } catch { /* the server is switching versions — keep waiting */ }
    }, 10_000);
    return () => clearInterval(id);
  }, [working, initial.version]);

  const start = async () => {
    if (!confirm('تحديث الخادم إلى آخر إصدار الآن؟\nيُثبَّت فقط إذا نجح فحص GitHub، والنظام يبقى يعمل أثناء البناء، ويرجع تلقائيًا عند أي خطأ.\nقد يتوقف النظام دقيقة تقريبًا لحظة التبديل.')) return;
    setBusy(true); setMsg(null);
    try { const r = await apiCall<{ state: ServerUpdateState }>('/api/system/update', { method: 'POST' }); setS(r.state); setMsg({ ok: true, t: 'أُرسل طلب التحديث — يبدأ خلال دقيقة.' }); }
    catch (x) { setMsg({ ok: false, t: (x as Error).message }); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-2 sm:grid-cols-3">
        <div><span className="text-slate-500">الإصدار العامل: </span><b className="ltr">{s.version}</b></div>
        <div><span className="text-slate-500">وكيل التحديث على الخادم: </span>{s.agentOnline ? <b className="text-emerald-700">متصل ✓</b> : <b className="text-amber-700">غير مفعّل</b>}</div>
        <div><span className="text-slate-500">آخر تحديث: </span>{s.last ? <>{s.last.state === 'ok' ? '✓ نجح' : s.last.state === 'fail' ? '✗ فشل' : '⏳ يعمل'} — {fmt(s.last.at)}</> : '—'}</div>
      </div>
      {s.last?.state === 'fail' && s.last.message && <p className="rounded-lg bg-red-50 p-2 text-xs text-red-800">{s.last.message} — النظام مستمر على الإصدار السابق.</p>}
      {!s.agentOnline && (
        <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
          ليعمل الزر، فعّل وكيل التحديث على الخادم مرة واحدة (Hetzner):
          <pre className="ltr mt-1 overflow-x-auto rounded bg-slate-900 p-2 text-[11px] text-slate-100">cd /opt/future-creative && bash scripts/update.sh && bash scripts/autoupdate.sh on main</pre>
          أو <span className="ltr">on button</span> بدل <span className="ltr">on main</span> إذا أردت التحديث بالزر فقط بدون تحديث تلقائي.
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={busy || working || !s.agentOnline} onClick={start}>{working ? '⏳ جارٍ التحديث…' : '🔄 تحديث الخادم الآن'}</Button>
        {s.pending && <span className="text-xs text-slate-500">طلب من {s.pending.by} — {fmt(s.pending.at)}</span>}
        {msg && <span className={msg.ok ? 'text-emerald-700' : 'text-red-700'}>{msg.t}</span>}
      </div>
      {s.agentOnline && s.agentMode && <p className="text-xs text-slate-500">وضع الوكيل: {s.agentMode === 'main' ? 'تلقائي مع كل دمج في main + الزر' : s.agentMode === 'release' ? 'تلقائي مع كل إصدار + الزر' : 'بالزر فقط'} — آخر اتصال {fmt(s.agentSeenAt)}</p>}
    </div>
  );
}
