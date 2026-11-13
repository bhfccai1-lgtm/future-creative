'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from './toaster';
import { Button } from './ui';
import { apiCall } from '@/lib/client/api';

type Variant = 'primary' | 'gold' | 'outline' | 'danger' | 'success' | 'ghost';

/** Calls a backend endpoint and refreshes server data — the UI only reflects state the backend confirmed. */
export function ActionButton({ url, body, label, variant = 'primary', size, confirm, prompt, promptKey, onDone, method = 'POST', block, success }: {
  url: string; method?: 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: Record<string, unknown>; label: React.ReactNode; variant?: Variant; size?: 'sm' | 'md' | 'lg';
  confirm?: string; prompt?: string; promptKey?: string; onDone?: (r: unknown) => void;
  /** full width (mobile action bars) */
  block?: boolean;
  /** toast text on success (else the server message, else «تم») */
  success?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span className={block ? 'flex w-full flex-col gap-1' : 'inline-flex flex-col gap-1'}>
      <Button variant={variant} size={size} className={block ? 'w-full whitespace-nowrap px-2' : undefined} disabled={pending} onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        let extra: Record<string, unknown> = {};
        if (prompt && promptKey) { const v = window.prompt(prompt); if (v === null) return; extra = { [promptKey]: v }; }
        start(async () => {
          try { const r = await apiCall<{ message?: string } | null>(url, { method, body: { ...(body ?? {}), ...extra } }); const text = r && typeof r.message === 'string' ? r.message : success ?? 'تم'; setMsg(null); toast(text); onDone?.(r); router.refresh(); }
          catch (e) { const text = (e as Error).message; setMsg({ ok: false, text }); toast(text, 'error'); }
        });
      }}>{pending ? '...' : label}</Button>
      {msg && <span className={msg.ok ? 'text-xs text-emerald-700' : 'max-w-xs text-xs text-red-700'}>{msg.text}</span>}
    </span>
  );
}
