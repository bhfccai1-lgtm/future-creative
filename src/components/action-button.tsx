'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from './ui';
import { apiCall } from '@/lib/client/api';

type Variant = 'primary' | 'gold' | 'outline' | 'danger' | 'success' | 'ghost';

/** Calls a backend endpoint and refreshes server data — the UI only reflects state the backend confirmed. */
export function ActionButton({ url, body, label, variant = 'primary', size, confirm, prompt, promptKey, onDone, method = 'POST' }: {
  url: string; method?: 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: Record<string, unknown>; label: React.ReactNode; variant?: Variant; size?: 'sm' | 'md' | 'lg';
  confirm?: string; prompt?: string; promptKey?: string; onDone?: (r: unknown) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <Button variant={variant} size={size} disabled={pending} onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        let extra: Record<string, unknown> = {};
        if (prompt && promptKey) { const v = window.prompt(prompt); if (v === null) return; extra = { [promptKey]: v }; }
        start(async () => {
          try { const r = await apiCall(url, { method, body: { ...(body ?? {}), ...extra } }); setMsg({ ok: true, text: 'تم ✓' }); onDone?.(r); router.refresh(); }
          catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
        });
      }}>{pending ? '...' : label}</Button>
      {msg && <span className={msg.ok ? 'text-xs text-emerald-700' : 'max-w-xs text-xs text-red-700'}>{msg.text}</span>}
    </span>
  );
}
