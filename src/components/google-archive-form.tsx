'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiCall } from '@/lib/client/api';
import { useEffect } from 'react';
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
        <Button type="button" size="sm" variant="outline" disabled={!configured} onClick={() => run(async () => { const r = await apiCall<{ version: number; outdated: boolean }>('/api/settings/google-archive', { body: {} }); if (r.outdated) throw new Error(`السكربت يعمل لكنه الإصدار ${r.version} — أنشئ السكربت الجديد بالأسفل والصقه مكان القديم ثم Deploy → Manage deployments → Edit → New version، حتى تعمل النسخ الاحتياطية ونقل التصاميم.`); return `السكربت يعمل ✓ (الإصدار ${r.version})`; })}>اختبار</Button>
        <Button type="button" size="sm" variant="outline" disabled={!configured} onClick={() => run(async () => { const r = await apiCall<{ queued: number }>('/api/settings/google-archive', { body: { backfill: true } }); return `أُرسل ${r.queued} منشورًا غير مؤرشف للأرشفة ✓ (تُرسل تباعًا خلال دقائق)`; })}>أرشفة المنشورات غير المؤرشفة</Button>
      </div>
      {msg && <p className={msg.ok ? 'text-emerald-700' : 'text-red-700'}>{msg.t}</p>}
    </div>
  );
}

type StorageView = { settings: { driveOffload: boolean; offloadAfterDays: number; keepDriveBackups: number; lastOffload: { at: string; removed: number; freedMb: number } | null }; stats: { files: number; onDrive: number; offloaded: number; freedMb: number; localMb: number } };
/** Google Drive as cold storage for published designs + where the database backups go */
export function DriveStorageForm({ configured }: { configured: boolean }) {
  const [v, setV] = useState<StorageView | null>(null);
  const [f, setF] = useState({ driveOffload: false, offloadAfterDays: 45, keepDriveBackups: 30 });
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const load = async () => { try { const r = await apiCall<StorageView>('/api/settings/google-archive/storage'); setV(r); setF({ driveOffload: r.settings.driveOffload, offloadAfterDays: r.settings.offloadAfterDays, keepDriveBackups: r.settings.keepDriveBackups }); } catch { /* not allowed */ } };
  useEffect(() => { void load(); }, []);
  const run = async (fn: () => Promise<string>) => { setMsg(null); try { setMsg({ ok: true, t: await fn() }); await load(); } catch (x) { setMsg({ ok: false, t: (x as Error).message }); } };
  if (!v) return null;
  return (
    <div className="mt-4 space-y-3 rounded-xl border border-slate-200 p-3 text-sm">
      <h3 className="font-extrabold">💾 Google Drive كمخزن للتصاميم والنسخ الاحتياطية</h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[['تصاميم منشورة لها نسخة في Drive', `${v.stats.onDrive} / ${v.stats.files}`], ['نُقلت من السيرفر', v.stats.offloaded], ['المساحة المحرّرة', `${v.stats.freedMb} MB`], ['ما زال على السيرفر', `${v.stats.localMb} MB`]].map(([k, x]) => (
          <div key={k as string} className="rounded-lg bg-slate-50 p-2"><div className="text-[11px] text-slate-500">{k}</div><div className="font-bold tabular-nums">{x}</div></div>
        ))}
      </div>
      <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={f.driveOffload} disabled={!configured} onChange={(e) => setF({ ...f, driveOffload: e.target.checked })} />
        <span><b>نقل التصاميم القديمة إلى Drive وتحرير مساحة السيرفر</b> — كل ليلة: التصاميم المنشورة منذ أكثر من
          <input type="number" min={7} max={365} className="input mx-1 inline-block w-20 ltr" value={f.offloadAfterDays} onChange={(e) => setF({ ...f, offloadAfterDays: Number(e.target.value) || 45 })} /> يومًا
          تُحذف من السيرفر <b>فقط</b> إذا أكّد Drive أن نسخته بنفس الحجم تمامًا، وتُفتح بعدها من Drive. الصور المصغّرة والتصاميم غير المنشورة وملفات الطباعة والتعليم تبقى على السيرفر.</span></label>
      <label className="flex items-center gap-2">احتفظ في Drive بآخر<input type="number" min={3} max={365} className="input w-20 ltr" value={f.keepDriveBackups} onChange={(e) => setF({ ...f, keepDriveBackups: Number(e.target.value) || 30 })} />نسخة احتياطية لقاعدة البيانات</label>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => run(async () => { await apiCall('/api/settings/google-archive/storage', { method: 'PUT', body: f }); return 'تم الحفظ ✓'; })}>حفظ</Button>
        <Button type="button" size="sm" variant="outline" disabled={!v.settings.driveOffload} onClick={() => run(async () => { const r = await apiCall<{ removed: number; freedMb: number; skipped: number }>('/api/settings/google-archive/storage', { body: {} }); return `نُقل ${r.removed} ملفًا وتحرّر ${r.freedMb} MB ✓${r.skipped ? ` — ${r.skipped} بانتظار تأكيد نسخة Drive` : ''}`; })}>حرّر المساحة الآن</Button>
      </div>
      {v.settings.lastOffload && <p className="text-xs text-slate-500">آخر تشغيل: {new Date(v.settings.lastOffload.at).toLocaleString('en-GB', { timeZone: 'Asia/Bahrain' })} — {v.settings.lastOffload.removed} ملف، {v.settings.lastOffload.freedMb} MB</p>}
      <div className="rounded-lg bg-slate-50 p-2 text-xs leading-6">
        <b>نسخة يومية لقاعدة البيانات إلى Drive</b> (مرة واحدة على السيرفر، من كونسول Hetzner):
        <pre className="mt-1 overflow-x-auto rounded bg-white p-2 ltr text-left">{`cd /opt/future-creative && bash scripts/drive-backup.sh
echo '20 2 * * * root cd /opt/future-creative && bash scripts/drive-backup.sh >> /var/log/fc-drive-backup.log 2>&1' > /etc/cron.d/future-creative-drive-backup`}</pre>
        قاعدة البيانات نفسها تعمل على السيرفر (لا يمكن تشغيلها من Drive)؛ نسخها تُحفظ في مجلد الأرشيف ← backups، ويبقى على السيرفر آخر 3 فقط.
      </div>
      {msg && <p className={msg.ok ? 'text-emerald-700' : 'text-red-700'}>{msg.t}</p>}
    </div>
  );
}
