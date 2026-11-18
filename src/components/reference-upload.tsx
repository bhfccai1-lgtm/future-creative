'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ImagePlus, Trash2 } from 'lucide-react';
import { apiCall } from '@/lib/client/api';

/** Upload / replace / remove a reference image (real product photo or reference design), with a live preview. */
export function ReferenceUpload({ endpoint, current, label, compact = false }: { endpoint: string; current: string | null; label: string; compact?: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [key, setKey] = useState(current);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const upload = async (f: File) => {
    setBusy(true); setErr(null);
    try {
      const fd = new FormData(); fd.append('file', f);
      const r = await apiCall<Record<string, string>>(endpoint, { form: fd });
      setKey(Object.values(r)[0] ?? null); router.refresh();
    } catch (x) { setErr((x as Error).message); }
    setBusy(false);
  };
  const remove = async () => {
    setBusy(true); setErr(null);
    try { await apiCall(endpoint, { method: 'DELETE' }); setKey(null); router.refresh(); } catch (x) { setErr((x as Error).message); }
    setBusy(false);
  };
  const size = compact ? 'h-12 w-12' : 'h-28 w-28';
  return (
    <div className="flex items-center gap-2">
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
      <button type="button" disabled={busy} onClick={() => input.current?.click()} aria-label={key ? `استبدال ${label}` : `رفع ${label}`}
        className={`${size} shrink-0 overflow-hidden rounded-xl border-2 ${key ? 'border-gold-500' : 'border-dashed border-slate-300'} flex items-center justify-center bg-slate-50 text-slate-400 hover:border-gold-500`}>
        {busy ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-navy-800" />
          : key ? <img src={`/api/media/${key}`} alt={label} className="h-full w-full object-cover" /> : <ImagePlus size={compact ? 18 : 26} />}
      </button>
      {!compact && <div className="text-xs text-slate-600">
        <div className="font-bold text-navy-800">{key ? '✓ مُفعّلة' : 'لم تُرفع بعد'}</div>
        <div>{key ? 'اضغط الصورة لاستبدالها' : 'JPG أو PNG، 1000 بكسل أو أكثر'}</div>
      </div>}
      {key && <button type="button" disabled={busy} onClick={remove} className="text-slate-400 hover:text-red-600" aria-label={`حذف ${label}`}><Trash2 size={compact ? 14 : 16} /></button>}
      {err && <span role="alert" className="text-xs text-red-600">{err}</span>}
    </div>
  );
}
