'use client';
import { useEffect, useState } from 'react';
import { apiCall } from '@/lib/client/api';
import { Button } from './ui';

type State = { enabled: boolean; model: string; key: { configured: boolean } };
/** FreeLLMAPI card: free provider tiers for idea suggestions only (falls back to OpenAI on any failure). */
export function FreeLlmSettings({ domain }: { domain?: string }) {
  const [v, setV] = useState<State | null>(null);
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { apiCall<State>('/api/settings/freellm').then(setV).catch(() => null); }, []);
  if (!v) return null;
  const save = async (patch: Partial<State> & { apiKey?: string }) => {
    setBusy(true); setMsg(null);
    try { const r = await apiCall<State>('/api/settings/freellm', { method: 'PUT', body: { enabled: v.enabled, model: v.model, ...patch } }); setV(r); setKey(''); setMsg({ ok: true, t: 'تم الحفظ ✓' }); }
    catch (x) { setMsg({ ok: false, t: (x as Error).message }); }
    setBusy(false);
  };
  const test = async () => { setBusy(true); try { const r = await apiCall<{ ok: boolean; message: string }>('/api/settings/freellm', { method: 'POST' }); setMsg({ ok: r.ok, t: r.message }); } catch (x) { setMsg({ ok: false, t: (x as Error).message }); } setBusy(false); };
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">يجمع الحصص المجانية لعشرات مزوّدي الذكاء الاصطناعي. يُستخدم هنا <b>لاقتراح الأفكار فقط</b> (بنك الأفكار، «اقترح 3 أفكار»، اختيار المفهوم). النص الإعلاني والملصق وتدقيق النص تبقى على OpenAI لضمان الجودة. إذا فشل يعود تلقائيًا إلى OpenAI.</p>
      <ol className="list-decimal space-y-1 pr-5 text-xs text-slate-600">
        <li>على السيرفر: <code dir="ltr">bash scripts/freellm.sh</code></li>
        <li>افتح لوحة FreeLLMAPI {domain ? <a className="font-bold underline" href={`https://ai.${domain}`} target="_blank" rel="noreferrer" dir="ltr">ai.{domain}</a> : null}، أنشئ الحساب بالرمز الذي يطبعه السكربت، وأضف مفاتيح المزوّدين المجانيين (Groq، Gemini، OpenRouter…).</li>
        <li>انسخ «المفتاح الموحد» من صفحة Keys والصقه هنا، ثم «اختبار الاتصال» ثم فعّل.</li>
      </ol>
      <div className="grid gap-3 md:grid-cols-3">
        <div><label className="label">المفتاح الموحد {v.key.configured ? '✓ محفوظ (مشفّر)' : ''}</label><input className="input ltr" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={v.key.configured ? '•••••• (اتركه فارغًا للإبقاء)' : 'freellmapi-…'} /></div>
        <div><label className="label">النموذج</label><input className="input ltr" value={v.model} onChange={(e) => setV({ ...v, model: e.target.value })} /><p className="mt-1 text-xs text-slate-500">auto = يختار الموجّه الأفضل المتاح</p></div>
        <label className="flex items-center gap-2 self-end pb-2"><input type="checkbox" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} /><b>تفعيل للأفكار</b></label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy} onClick={() => save({ apiKey: key || undefined })}>حفظ</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={test}>اختبار الاتصال</Button>
        {v.key.configured && <Button type="button" variant="ghost" disabled={busy} onClick={() => { if (confirm('حذف المفتاح؟')) void save({ apiKey: '__delete__', enabled: false }); }}>حذف المفتاح</Button>}
      </div>
      {msg && <p role="status" className={`rounded p-2 text-sm ${msg.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{msg.t}</p>}
    </div>
  );
}
