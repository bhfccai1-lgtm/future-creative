'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiCall } from '@/lib/client/api';
import { Button } from './ui';

type Result = { id: string; ok: boolean; message: string };

/** «🛠 إصلاح الآن» for one finding, or «إصلاح كل ما يمكن آليًا» for several — shows each result, then refreshes the page. */
export function FixButton({ ids, label, confirmText, size = 'sm' }: { ids: string[]; label: string; confirmText?: string; size?: 'sm' | 'md' }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-1">
      <Button type="button" size={size} variant="gold" disabled={busy || !ids.length} onClick={async () => {
        if (confirmText && !confirm(confirmText)) return;
        setBusy(true); setErr(null); setRes(null);
        try { const r = await apiCall<{ results: Result[] }>('/api/diagnostics/fix', { method: 'POST', body: { ids } }); setRes(r.results); router.refresh(); }
        catch (x) { setErr((x as Error).message); }
        finally { setBusy(false); }
      }}>{busy ? '⏳ جارٍ الإصلاح…' : label}</Button>
      {res?.map((r) => <p key={r.id} className={`text-xs ${r.ok ? 'text-emerald-700' : 'text-red-700'}`}>{r.ok ? '✓' : '✗'} {r.message}</p>)}
      {err && <p className="text-xs text-red-700">{err}</p>}
    </div>
  );
}
