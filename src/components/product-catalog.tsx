'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Upload, Download } from 'lucide-react';
import { apiCall } from '@/lib/client/api';
import { Button, Badge } from './ui';

type Summary = { dryRun: boolean; total: number; create: number; update: number; newCategories: string[]; errors: { line: number; message: string }[]; errorCount: number; sample: { line: number; titleAr: string; category: string }[] };

export function ProductImport() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [res, setRes] = useState<Summary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async (dryRun: boolean) => {
    setBusy(true); setErr(null);
    const fd = new FormData(); if (file) fd.set('file', file); if (url) fd.set('url', url); fd.set('dryRun', dryRun ? '1' : '0');
    try {
      const j = await apiCall<Summary>('/api/products/import', { form: fd });
      setRes(j); if (!dryRun) router.refresh();
    } catch (x) { setErr((x as Error).message); }
    setBusy(false);
  };
  return (
    <div className="space-y-3">
      <ol className="list-decimal space-y-0.5 pr-5 text-xs text-slate-600">
        <li>نزّل <a className="font-bold text-navy-700 underline" href="/api/products/export" download>القالب / المنتجات الحالية (CSV)</a> وافتحه في Excel أو Google Sheets.</li>
        <li>أضف منتجاتك صفًا لكل منتج. <b>الإلزامي فقط:</b> الفئة + الاسم بالعربية (أو الإنجليزية). الباقي يُعبَّأ تلقائيًا. القوائم تُفصل بـ <span className="ltr">|</span>.</li>
        <li>احفظ كـ «CSV UTF-8» وارفعه هنا، أو شارك جدول Google Sheets «لأي شخص لديه الرابط» والصق الرابط.</li>
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <input type="file" accept=".csv,text/csv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setRes(null); }} className="text-sm" />
        <span className="text-xs text-slate-500">أو</span>
        <input className="input ltr" style={{ width: '22rem' }} placeholder="https://docs.google.com/spreadsheets/d/…" value={url} onChange={(e) => { setUrl(e.target.value.trim()); setRes(null); }} />
        <Button type="button" size="sm" variant="outline" disabled={busy || (!file && !url)} onClick={() => send(true)}><Upload size={14} />{busy ? '…' : 'معاينة'}</Button>
        {res?.dryRun && res.total > 0 && <Button type="button" size="sm" variant="gold" disabled={busy} onClick={() => send(false)}>تأكيد الاستيراد ({res.total})</Button>}
        <a href="/api/products/export" download className="inline-flex items-center gap-1 text-xs text-navy-700 underline"><Download size={12} />تصدير</a>
      </div>
      {err && <p className="text-sm text-red-700">{err}</p>}
      {res && (
        <div className={`rounded-lg border p-3 text-sm ${res.dryRun ? 'bg-amber-50' : 'bg-emerald-50'}`}>
          <b>{res.dryRun ? 'معاينة (لم يُحفظ شيء بعد):' : 'تم الاستيراد ✓'}</b> {res.total} صف صالح — جديد {res.create} · تحديث {res.update}{res.newCategories.length ? ` · فئات جديدة: ${res.newCategories.join('، ')}` : ''}
          {res.errorCount > 0 && <div className="mt-2 text-red-700">صفوف مرفوضة ({res.errorCount}): {res.errors.slice(0, 8).map((e) => `سطر ${e.line}: ${e.message}`).join(' · ')}{res.errorCount > 8 ? ' …' : ''}</div>}
          {res.dryRun && res.sample.length > 0 && <div className="mt-2 text-xs text-slate-600">أمثلة: {res.sample.map((s) => `${s.titleAr} (${s.category})`).join('، ')}</div>}
        </div>
      )}
    </div>
  );
}

type Row = { id: string; titleAr: string; titleEn: string; category: string; active: boolean; ads: number; perf: number };
export function ProductTable({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [sel, setSel] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const bulk = async (active: boolean) => {
    try { const r = await apiCall<{ updated: number }>('/api/products/bulk', { body: { ids: sel, active } }); setMsg(`تم تحديث ${r.updated} ✓`); setSel([]); router.refresh(); }
    catch (x) { setMsg((x as Error).message); }
  };
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1"><input type="checkbox" checked={rows.length > 0 && sel.length === rows.length} onChange={(e) => setSel(e.target.checked ? rows.map((r) => r.id) : [])} /> تحديد الصفحة</label>
        <Button size="sm" variant="success" type="button" disabled={!sel.length} onClick={() => bulk(true)}>تفعيل المحدد ({sel.length})</Button>
        <Button size="sm" variant="outline" type="button" disabled={!sel.length} onClick={() => bulk(false)}>إيقاف المحدد</Button>
        {msg && <span className="text-xs text-emerald-700">{msg}</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead><tr><th className="th w-8"></th><th className="th">المنتج</th><th className="th">الفئة</th><th className="th">الأداء</th><th className="th">الإعلانات</th><th className="th">الحالة</th></tr></thead>
          <tbody>{rows.map((p) => (
            <tr key={p.id} className="border-t">
              <td className="td"><input type="checkbox" checked={sel.includes(p.id)} onChange={(e) => setSel(e.target.checked ? [...sel, p.id] : sel.filter((x) => x !== p.id))} aria-label={p.titleAr} /></td>
              <td className="td"><div className="font-bold">{p.titleAr}</div><div className="text-xs text-slate-500 ltr">{p.titleEn}</div></td>
              <td className="td text-xs">{p.category}</td>
              <td className="td text-xs">{p.perf === 0 ? '—' : p.perf.toFixed(2)}</td>
              <td className="td">{p.ads}</td>
              <td className="td">{p.active ? <Badge tone="green">نشط</Badge> : <Badge>متوقف</Badge>}</td>
            </tr>))}</tbody>
        </table>
      </div>
    </div>
  );
}
