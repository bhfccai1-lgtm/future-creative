'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiCall } from '@/lib/client/api';
import { useEffect } from 'react';
import { Button } from './ui';

type LastTest = { at: string; ok: boolean; message: string; version: number | null; folderName: string | null; sheetName: string | null };
type ArchiveStatus = { folderUrl: string; sheetUrl: string; configured: boolean; lastTest: LastTest | null; latestVersion: number };
const when = (iso: string) => new Date(iso).toLocaleString('ar-BH', { dateStyle: 'medium', timeStyle: 'short' });

export function GoogleArchiveForm({ configured: initial }: { configured: boolean }) {
  const router = useRouter();
  const [st, setSt] = useState<ArchiveStatus | null>(null);
  const [url, setUrl] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [folder, setFolder] = useState(''); const [sheet, setSheet] = useState(''); const [script, setScript] = useState(''); const [copied, setCopied] = useState(false);
  // the saved links come back from the database every time the page opens
  const load = async () => { try { const r = await apiCall<ArchiveStatus>('/api/settings/google-archive'); setSt(r); setFolder(r.folderUrl); setSheet(r.sheetUrl); } catch { /* not allowed */ } };
  useEffect(() => { void load(); }, []);
  const run = async (f: () => Promise<string>) => { setMsg(null); try { setMsg({ ok: true, t: await f() }); await load(); router.refresh(); } catch (x) { setMsg({ ok: false, t: (x as Error).message }); await load(); } };
  const configured = st?.configured ?? initial;
  const linksSaved = !!st?.folderUrl && !!st?.sheetUrl;
  const linksChanged = folder.trim() !== (st?.folderUrl ?? '') || sheet.trim() !== (st?.sheetUrl ?? '');
  const t = st?.lastTest;
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">بدون n8n وبدون Google Cloud: سكربت Apps Script في حسابك يستقبل كل منشور مؤكد، فيحفظ ملفاته في مجلد الأرشيف (مجلد لكل حساب) ويضيف صفًا في ورقة «published». إعادة المحاولة تلقائية ولا تكرار.</p>

      {/* connection status: what the script answered on its last test */}
      <div className={`rounded-lg border p-3 ${!configured ? 'border-slate-200 bg-slate-50' : t?.ok ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
        <div className="font-bold">{!configured ? 'غير متصل بعد' : !t ? 'محفوظ — اضغط «اختبار» للتحقق من الاتصال' : t.ok ? '✓ متصل ويعمل' : '⚠️ يحتاج إجراء'}</div>
        {t && <div className="mt-1 text-xs text-slate-700">{t.message}</div>}
        <div className="mt-1 text-xs text-slate-500">
          إصدار السكربت المتصل: <b className="ltr">{t?.version ? `v${t.version}` : '—'}</b> · أحدث إصدار: <b className="ltr">v{st?.latestVersion ?? '—'}</b>
          {t?.folderName && <> · المجلد: <b>{t.folderName}</b></>}{t?.sheetName && <> · الجدول: <b>{t.sheetName}</b></>}
          {t && <> · آخر اختبار: {when(t.at)}</>}
        </div>
      </div>

      <details className="rounded-lg border p-3" open={!configured || !linksSaved}>
        <summary className="cursor-pointer font-bold text-navy-800">① روابط الأرشيف ثم السكربت {linksSaved && <span className="text-xs font-normal text-emerald-700">— محفوظة ✓</span>}</summary>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <input className="input ltr" placeholder="https://drive.google.com/drive/folders/…" value={folder} onChange={(e) => setFolder(e.target.value)} aria-label="رابط مجلد الأرشيف" />
          <input className="input ltr" placeholder="https://docs.google.com/spreadsheets/d/…" value={sheet} onChange={(e) => setSheet(e.target.value)} aria-label="رابط جدول الأرشيف" />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={!folder || !sheet || !linksChanged} onClick={() => run(async () => { await apiCall<{ saved: boolean }>('/api/settings/google-archive', { method: 'PUT', body: { folder, sheet } }); setScript(''); return 'حُفظت روابط الأرشيف في قاعدة البيانات ✓'; })}>حفظ روابط الأرشيف</Button>
          <Button type="button" size="sm" variant="outline" disabled={!linksSaved || linksChanged} onClick={() => run(async () => { const r = await apiCall<{ script: string }>('/api/settings/google-archive?script=1'); setScript(r.script); setCopied(false); return 'السكربت جاهز ✓ — انسخه والصقه في Apps Script (فيه مفتاح المصادقة الخاص بنظامك)'; })}>إنشاء السكربت</Button>
          {script && <Button type="button" size="sm" variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(script); setCopied(true); } catch { setCopied(false); } }}>{copied ? 'نُسخ ✓' : 'نسخ السكربت'}</Button>}
        </div>
        {linksChanged && linksSaved && <p className="mt-1 text-xs text-amber-700">غيّرت الروابط — احفظها أولًا، ثم أنشئ السكربت من جديد والصقه مكان القديم.</p>}
        {script && <textarea readOnly className="input mt-2 h-40 font-mono text-xs ltr" dir="ltr" value={script} onFocus={(e) => e.currentTarget.select()} />}
      </details>

      <div className="font-bold text-navy-800">② الصق رابط تطبيق الويب (/exec) واحفظ</div>
      <div className="flex flex-wrap items-center gap-2">
        <input className="input ltr" style={{ width: '30rem' }} placeholder={configured ? 'محفوظ ✓ — اتركه فارغًا للإبقاء عليه' : 'https://script.google.com/macros/s/…/exec'} value={url} onChange={(e) => setUrl(e.target.value.trim())} />
        <Button type="button" size="sm" disabled={!url} onClick={() => run(async () => { const r = await apiCall<{ saved: boolean; configured: boolean }>('/api/settings/google-archive', { method: 'PUT', body: { url } }); if (!r.saved || !r.configured) throw new Error('لم يتأكد الحفظ — أعد المحاولة.'); setUrl(''); return 'حُفظ رابط السكربت في قاعدة البيانات ✓ — اضغط «اختبار» للتحقق من الاتصال'; })}>حفظ</Button>
        <Button type="button" size="sm" variant="outline" disabled={!configured} onClick={() => run(async () => { const r = await apiCall<{ lastTest: LastTest }>('/api/settings/google-archive', { body: {} }); if (!r.lastTest.ok) throw new Error(r.lastTest.message); return r.lastTest.message; })}>اختبار</Button>
        <Button type="button" size="sm" variant="outline" disabled={!configured} onClick={() => run(async () => { const r = await apiCall<{ queued: number }>('/api/settings/google-archive', { body: { backfill: true } }); return `أُرسل ${r.queued} منشورًا غير مؤرشف للأرشفة ✓ (تُرسل تباعًا خلال دقائق)`; })}>أرشفة المنشورات غير المؤرشفة</Button>
      </div>
      {msg && <p className={msg.ok ? 'text-emerald-700' : 'text-red-700'}>{msg.t}</p>}
      <p className="text-xs text-slate-500">🔒 كل طلب للسكربت يحمل مفتاح مصادقة سريًا من نظامك، والسكربت يرفض أي طلب بدونه. ولا يُحذف أي تصميم من السيرفر إلا بعد أن يطابق Drive حجمه وبصمته SHA-256 لحظة الحذف.</p>
    </div>
  );
}

type StorageView = { settings: { driveSmart?: boolean; driveOffload: boolean; offloadAfterDays: number; keepDriveBackups: number; lastOffload: { at: string; removed: number; freedMb: number } | null }; stats: { files: number; onDrive: number; offloaded: number; freedMb: number; localMb: number } };
/** Google Drive as cold storage for published designs + where the database backups go */
export function DriveStorageForm({ configured }: { configured: boolean }) {
  const [v, setV] = useState<StorageView | null>(null);
  const [f, setF] = useState({ driveOffload: false, offloadAfterDays: 45, keepDriveBackups: 30, driveSmart: false });
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const load = async () => { try { const r = await apiCall<StorageView>('/api/settings/google-archive/storage'); setV(r); setF({ driveOffload: r.settings.driveOffload, offloadAfterDays: r.settings.offloadAfterDays, keepDriveBackups: r.settings.keepDriveBackups, driveSmart: !!r.settings.driveSmart }); } catch { /* not allowed */ } };
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
      <div className="rounded-lg border border-gold-500/60 bg-gold-300/10 p-2.5">
        <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={f.driveSmart} disabled={!configured} onChange={(e) => setF({ ...f, driveSmart: e.target.checked })} />
          <span><b>✨ Drive الذكي</b> — كل ليلة: أرقام كل تصميم (مشاهدات، حفظ، مشاركات، إكمال، تخطٍّ، درجة أداء) في جدول الأرشيف، ونسخ أفضل 3 تصاميم لكل حساب في مجلد <b>«⭐ أفضل التصاميم»</b> (معرض أعمال جاهز للمشاركة)، وفي أول كل شهر <b>تقرير ذكي</b> في Google Docs ← «التقارير».</span></label>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={!configured} onClick={() => run(async () => { const r = await apiCall<{ metrics: { updated: number }; best: { designs: number } }>('/api/settings/google-archive/smart', { body: { action: 'sync' } }); return `حُدّثت أرقام ${r.metrics.updated} تصميم، وأُضيف ${r.best.designs} تصميم لـ«⭐ أفضل التصاميم» ✓`; })}>زامن الآن</Button>
          <Button type="button" size="sm" variant="outline" disabled={!configured} onClick={() => run(async () => { const r = await apiCall<{ title: string; url: string; source: string }>('/api/settings/google-archive/smart', { body: { action: 'report' } }); return `${r.title} جاهز (${r.source === 'ai' ? 'بالذكاء الاصطناعي' : 'من الأرقام'}) ✓ ${r.url}`; })}>أنشئ التقرير الشهري الآن</Button>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">يحتاج السكربت الإصدار 3 (أنشئه من جديد بالأعلى والصقه ثم New version). التقرير بالذكاء الاصطناعي = طلب نصي واحد صغير في الشهر؛ بدون مفتاح يُكتب من الأرقام.</p>
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
