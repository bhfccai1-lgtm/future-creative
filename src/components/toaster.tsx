'use client';
import { useEffect, useState } from 'react';

/** App-wide toasts (above the phone tab bar): `toast('تم ✓')`, `toast('خطأ…', 'error')`. Short haptic tap on phones that support it. */
type T = { id: number; text: string; kind: 'ok' | 'error' };
const EVT = 'fc-toast';
export function toast(text: string, kind: 'ok' | 'error' = 'ok') {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<Omit<T, 'id'>>(EVT, { detail: { text, kind } }));
  try { navigator.vibrate?.(kind === 'ok' ? 15 : [30, 40, 30]); } catch { /* not supported */ }
}

export function Toaster() {
  const [items, setItems] = useState<T[]>([]);
  useEffect(() => {
    let n = 0;
    const on = (e: Event) => {
      const d = (e as CustomEvent<Omit<T, 'id'>>).detail; const id = ++n;
      setItems((x) => [...x.slice(-2), { id, ...d }]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), d.kind === 'error' ? 7000 : 3200);
    };
    window.addEventListener(EVT, on);
    return () => window.removeEventListener(EVT, on);
  }, []);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4 lg:bottom-6">
      {items.map((t) => (
        <div key={t.id} role="status" className={`pointer-events-auto max-w-md rounded-xl px-4 py-3 text-sm font-bold shadow-lg ring-1 animate-[fcToast_.25s_ease-out] ${t.kind === 'ok' ? 'bg-navy-900 text-white ring-navy-700' : 'bg-red-600 text-white ring-red-700'}`}
          onClick={() => setItems((x) => x.filter((i) => i.id !== t.id))}>
          {t.kind === 'ok' ? '✓ ' : '⚠️ '}{t.text}
        </div>
      ))}
    </div>
  );
}
