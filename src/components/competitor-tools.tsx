'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Sparkles, Upload } from 'lucide-react';
import { apiCall } from '@/lib/client/api';
import { Button } from './ui';

export function CsvImport({ brandId }: { brandId: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={async (e) => {
      e.preventDefault(); setMsg(null); setBusy(true);
      const fd = new FormData(e.currentTarget); fd.set('brandId', brandId);
      try {
        const csrf = document.cookie.split('; ').find((c) => c.startsWith('fc_csrf='))?.split('=')[1] ?? '';
        const r = await fetch('/api/competitors/import', { method: 'POST', body: fd, headers: { 'x-csrf-token': csrf } });
        const j = await r.json();
        if (!r.ok) throw new Error(j.message ?? 'فشل الاستيراد');
        setMsg({ ok: true, t: `تم استيراد ${j.rows} ${j.kind === 'posts' ? 'منشور' : 'منافس'} ✓` }); router.refresh();
      } catch (x) { setMsg({ ok: false, t: (x as Error).message }); }
      setBusy(false);
    }}>
      <input type="file" name="file" accept=".csv,text/csv" required className="text-sm" />
      <Button size="sm" variant="outline" disabled={busy}><Upload size={14} />{busy ? 'جارٍ الاستيراد…' : 'استيراد CSV من Metricool'}</Button>
      {msg && <span className={msg.ok ? 'text-sm text-emerald-700' : 'text-sm text-red-700'}>{msg.t}</span>}
    </form>
  );
}

type Idea = { title: string; idea: string };
export function InspiredIdeas({ brandId, accounts }: { brandId: string; accounts: { id: string; name: string }[] }) {
  const [acc, setAcc] = useState(accounts[0]?.id ?? '');
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className="input" style={{ width: '14rem' }} value={acc} onChange={(e) => setAcc(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <Button type="button" variant="gold" size="sm" disabled={busy || !acc} onClick={async () => {
          setBusy(true); setErr(null);
          try { setIdeas((await apiCall<{ ideas: Idea[] }>('/api/competitors/ideas', { body: { accountId: acc, brandId } })).ideas); }
          catch (x) { setErr((x as Error).message); }
          setBusy(false);
        }}><Sparkles size={14} />{busy ? 'جارٍ التفكير…' : 'أفكار أصلية مستوحاة من السوق'}</Button>
      </div>
      {err && <p className="text-sm text-red-700">{err}</p>}
      {ideas && <div className="grid gap-2 md:grid-cols-3">{ideas.map((i, k) => (
        <div key={k} className="rounded-xl border p-3 text-sm"><div className="font-extrabold text-navy-900">{i.title}</div><p className="mt-1 text-xs text-slate-600">{i.idea}</p>
          <a className="mt-2 inline-block text-xs font-bold text-gold-600 underline" href={`/create?idea=${encodeURIComponent(i.idea)}`}>استخدم هذه الفكرة ←</a></div>
      ))}</div>}
      <p className="text-xs text-slate-500">تُبنى الأفكار من المواضيع والصيغ الناجحة لدى المنافسين، مع تعليمات صريحة بعدم نسخ نصوصهم أو تصاميمهم.</p>
    </div>
  );
}
