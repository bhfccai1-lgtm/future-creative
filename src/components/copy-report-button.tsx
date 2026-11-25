'use client';
import { useState } from 'react';
import { Button } from './ui';

/** Copies the plain-text diagnostics report (no secrets) — the owner pastes it to support instead of screenshots. */
export function CopyReportButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button type="button" variant="ghost" size="sm" onClick={async () => {
      try { await navigator.clipboard.writeText(text); } catch {
        const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
      }
      setDone(true); setTimeout(() => setDone(false), 2500);
    }}>{done ? 'تم النسخ ✓' : '📋 نسخ تقرير للدعم'}</Button>
  );
}
