'use client';
import { useEffect, useState } from 'react';
import { apiCall } from '@/lib/client/api';
import { Button } from './ui';

type View = { cloud: { enabled: boolean; phoneNumberId: string; ownerNumbers: string[]; autoAck: boolean; ackText: string }; webhookUrl: string; verifyToken: string; token: boolean; appSecret: boolean };

/** «واتساب الذكي»: the owner's copilot on WhatsApp + customer messages → leads (WhatsApp Cloud API, Meta) */
export function WhatsappCloudForm() {
  const [v, setV] = useState<View | null>(null);
  const [f, setF] = useState({ enabled: false, phoneNumberId: '', owners: '', autoAck: false, ackText: '', token: '', appSecret: '' });
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const load = async () => { try { const r = await apiCall<View>('/api/settings/whatsapp-cloud'); setV(r); setF({ enabled: r.cloud.enabled, phoneNumberId: r.cloud.phoneNumberId, owners: r.cloud.ownerNumbers.join('\n'), autoAck: r.cloud.autoAck, ackText: r.cloud.ackText, token: '', appSecret: '' }); } catch { /* no permission */ } };
  useEffect(() => { void load(); }, []);
  const run = async (fn: () => Promise<string>) => { setMsg(null); try { setMsg({ ok: true, t: await fn() }); await load(); } catch (x) { setMsg({ ok: false, t: (x as Error).message }); } };
  if (!v) return null;
  const copy = (t: string) => navigator.clipboard.writeText(t).catch(() => undefined);
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">رقمك يكلّم <b>المساعد الذكي</b> على الواتساب (اسأله أو اطلب تصميمًا، وينفّذ بعد ردّك «تأكيد»)، وأي عميل يراسل الرقم التجاري يُسجَّل تلقائيًا في «العملاء والطلبات» مع تنبيه لك.</p>
      <ol className="list-decimal space-y-1 ps-5 text-xs text-slate-700">
        <li>في <span className="ltr">developers.facebook.com</span> ← تطبيقك ← WhatsApp ← API Setup: انسخ <b>Phone number ID</b> ورمز وصول دائم (System user).</li>
        <li>App settings ← Basic: انسخ <b>App Secret</b>.</li>
        <li>WhatsApp ← Configuration ← Webhook: الصق الرابط ورمز التحقق أدناه، ثم اشترك في <b>messages</b>.</li>
      </ol>
      <div className="grid gap-2 rounded-lg bg-slate-50 p-2 text-xs">
        <div className="flex flex-wrap items-center gap-2"><b>Callback URL:</b><code className="ltr break-all">{v.webhookUrl}</code><button type="button" className="rounded border px-2" onClick={() => copy(v.webhookUrl)}>نسخ</button></div>
        <div className="flex flex-wrap items-center gap-2"><b>Verify token:</b><code className="ltr break-all">{v.verifyToken}</code><button type="button" className="rounded border px-2" onClick={() => copy(v.verifyToken)}>نسخ</button></div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs font-bold">Phone number ID<input className="input ltr mt-1" inputMode="numeric" value={f.phoneNumberId} onChange={(e) => setF({ ...f, phoneNumberId: e.target.value.trim() })} /></label>
        <label className="text-xs font-bold">رمز الوصول (Access token)<input className="input ltr mt-1" type="password" autoComplete="off" placeholder={v.token ? 'محفوظ ✓ — اتركه فارغًا للإبقاء عليه' : 'EAA…'} value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })} /></label>
        <label className="text-xs font-bold">App Secret<input className="input ltr mt-1" type="password" autoComplete="off" placeholder={v.appSecret ? 'محفوظ ✓' : '32 حرفًا'} value={f.appSecret} onChange={(e) => setF({ ...f, appSecret: e.target.value })} /></label>
        <label className="text-xs font-bold">أرقام المالك (رقم في كل سطر)<textarea className="input ltr mt-1 min-h-[60px]" value={f.owners} onChange={(e) => setF({ ...f, owners: e.target.value })} placeholder="3xxxxxxx" /></label>
      </div>
      <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={f.autoAck} onChange={(e) => setF({ ...f, autoAck: e.target.checked })} /><span><b>رد ترحيب تلقائي للعملاء</b> (مرة كل ٢٤ ساعة للعميل):</span></label>
      {f.autoAck && <textarea className="input min-h-[60px] text-xs" maxLength={600} value={f.ackText} onChange={(e) => setF({ ...f, ackText: e.target.value })} />}
      <label className="flex items-center gap-2 font-bold"><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />تفعيل واتساب الذكي</label>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => run(async () => { await apiCall('/api/settings/whatsapp-cloud', { method: 'PUT', body: { enabled: f.enabled, phoneNumberId: f.phoneNumberId, ownerNumbers: f.owners.split(/\s+/).filter(Boolean), autoAck: f.autoAck, ackText: f.ackText || v.cloud.ackText, token: f.token || undefined, appSecret: f.appSecret || undefined } }); return 'تم الحفظ ✓'; })}>حفظ</Button>
        <Button type="button" size="sm" variant="outline" disabled={!v.cloud.enabled} onClick={() => run(async () => { await apiCall('/api/settings/whatsapp-cloud', { body: {} }); return 'أُرسلت رسالة التجربة لرقمك ✓'; })}>رسالة تجربة لرقمي</Button>
      </div>
      <p className="text-[11px] text-slate-500">قاعدة واتساب: الرد الحر مسموح خلال ٢٤ ساعة من آخر رسالة من الطرف الآخر — ابدأ أنت المحادثة مع الرقم التجاري أول مرة. الرموز تُحفظ مشفّرة ولا تُعرض.</p>
      {msg && <p className={msg.ok ? 'text-emerald-700' : 'text-red-700'}>{msg.t}</p>}
    </div>
  );
}
