'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiCall } from '@/lib/client/api';
import { Button } from './ui';

export function GoogleArchiveForm({ configured }: { configured: boolean }) {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const run = async (f: () => Promise<string>) => { setMsg(null); try { setMsg({ ok: true, t: await f() }); router.refresh(); } catch (x) { setMsg({ ok: false, t: (x as Error).message }); } };
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">بدون n8n وبدون Google Cloud: سكربت Apps Script في حسابك يستقبل كل منشور مؤكد، فيحفظ ملفاته في مجلد الأرشيف (مجلد لكل حساب) ويضيف صفًا في ورقة «published». إعادة المحاولة تلقائية ولا تكرار.</p>
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
