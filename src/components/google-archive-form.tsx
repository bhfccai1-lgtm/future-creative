'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiCall } from '@/lib/client/api';
import { Button } from './ui';

export function GoogleArchiveForm({ configured }: { configured: boolean }) {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [folder, setFolder] = useState(''); const [sheet, setSheet] = useState(''); const [script, setScript] = useState(''); const [copied, setCopied] = useState(false);
  const run = async (f: () => Promise<string>) => { setMsg(null); try { setMsg({ ok: true, t: await f() }); router.refresh(); } catch (x) { setMsg({ ok: false, t: (x as Error).message }); } };
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">بدون n8n وبدون Google Cloud: سكربت Apps Script في حسابك يستقبل كل منشور مؤكد، فيحفظ ملفاته في مجلد الأرشيف (مجلد لكل حساب) ويضيف صفًا في ورقة «published». إعادة المحاولة تلقائية ولا تكرار.</p>
      <details className="rounded-lg border p-3" open={!configured}>
        <summary className="cursor-pointer font-bold text-navy-800">① اصنع السكربت (الصق رابط المجلد والجدول)</summary>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <input className="input ltr" placeholder="https://drive.google.com/drive/folders/…" value={folder} onChange={(e) => setFolder(e.target.value)} aria-label="رابط مجلد الأرشيف" />
          <input className="input ltr" placeholder="https://docs.google.com/spreadsheets/d/…" value={sheet} onChange={(e) => setSheet(e.target.value)} aria-label="رابط جدول الأرشيف" />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={!folder || !sheet} onClick={() => run(async () => { const r = await apiCall<{ script: string }>(`/api/settings/google-archive?folder=${encodeURIComponent(folder)}&sheet=${encodeURIComponent(sheet)}`); setScript(r.script); setCopied(false); return 'السكربت جاهز ✓ — انسخه والصقه في Apps Script'; })}>إنشاء السكربت</Button>
          {script && <Button type="button" size="sm" variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(script); setCopied(true); } catch { setCopied(false); } }}>{copied ? 'نُسخ ✓' : 'نسخ السكربت'}</Button>}
        </div>
        {script && <textarea readOnly className="input mt-2 h-40 font-mono text-xs ltr" dir="ltr" value={script} onFocus={(e) => e.currentTarget.select()} />}
      </details>
      <div className="font-bold text-navy-800">② الصق رابط تطبيق الويب (/exec) واحفظ</div>
      <div className="flex flex-wrap items-center gap-2">
        <input className="input ltr" style={{ width: '30rem' }} placeholder={configured ? 'محفوظ ✓ — اتركه فارغًا للإبقاء عليه' : 'https://script.google.com/macros/s/…/exec'} value={url} onChange={(e) => setUrl(e.target.value.trim())} />
        <Button type="button" size="sm" disabled={!url} onClick={() => run(async () => { await apiCall('/api/settings/google-archive', { method: 'PUT', body: { url } }); setUrl(''); return 'تم الحفظ ✓'; })}>حفظ</Button>
        <Button type="button" size="sm" variant="outline" disabled={!configured} onClick={() => run(async () => { await apiCall('/api/settings/google-archive', { body: {} }); return 'السكربت يعمل ✓'; })}>اختبار</Button>
        <Button type="button" size="sm" variant="outline" disabled={!configured} onClick={() => run(async () => { const r = await apiCall<{ queued: number }>('/api/settings/google-archive', { body: { backfill: true } }); return `أُرسل آخر ${r.queued} منشور مؤكد للأرشفة ✓ (خلال دقيقة)`; })}>أرشفة آخر 20 منشورًا الآن</Button>
      </div>
      {msg && <p className={msg.ok ? 'text-emerald-700' : 'text-red-700'}>{msg.t}</p>}
    </div>
  );
}
