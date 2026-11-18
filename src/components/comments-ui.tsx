'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, Check, EyeOff, Send, ExternalLink, RefreshCw } from 'lucide-react';
import { apiCall } from '@/lib/client/api';
import { Button } from './ui';

const CAT: Record<string, { ar: string; cls: string }> = {
  order: { ar: 'طلب / شراء', cls: 'bg-emerald-100 text-emerald-800' }, price: { ar: 'سؤال عن السعر', cls: 'bg-gold-300/40 text-navy-900' },
  info: { ar: 'استفسار', cls: 'bg-sky-100 text-sky-800' }, praise: { ar: 'مدح', cls: 'bg-pink-100 text-pink-800' },
  complaint: { ar: 'شكوى', cls: 'bg-red-100 text-red-800' }, spam: { ar: 'إزعاج / سبام', cls: 'bg-slate-200 text-slate-700' }, other: { ar: 'أخرى', cls: 'bg-slate-100 text-slate-700' },
};
export type CommentRow = { id: string; account: string; username: string | null; text: string; postedAt: string | null; source: string; category: string | null; sentiment: string | null; urgent: boolean; summary: string | null; suggestedReply: string | null; status: string; repliedText: string | null; permalink: string | null };

export function CommentCard({ c, canSend }: { c: CommentRow; canSend: boolean }) {
  const router = useRouter();
  const [reply, setReply] = useState(c.suggestedReply ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const cat = CAT[c.category ?? 'other'] ?? CAT.other;
  const run = async (f: () => Promise<string>) => { setBusy(true); setMsg(null); try { setMsg({ ok: true, t: await f() }); router.refresh(); } catch (x) { setMsg({ ok: false, t: (x as Error).message }); } setBusy(false); };
  const graph = c.source === 'graph';
  return (
    <article className={`rounded-2xl border bg-white p-4 shadow-sm ${c.urgent && c.status === 'NEW' ? 'border-r-4 border-r-red-500' : ''}`}>
      <header className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded-full px-2.5 py-0.5 font-bold ${cat.cls}`}>{cat.ar}</span>
        {c.urgent && c.status === 'NEW' && <span className="rounded-full bg-red-600 px-2 py-0.5 font-bold text-white">عاجل</span>}
        {c.sentiment === 'negative' && <span className="text-red-700">😟 سلبي</span>}
        <span className="text-slate-500">{c.account}</span>
        {c.postedAt && <time className="ltr text-slate-400" dateTime={c.postedAt}>{new Date(c.postedAt).toLocaleString('en-GB', { timeZone: 'Asia/Bahrain', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>}
        {c.permalink && <a href={c.permalink} target="_blank" rel="noreferrer" className="mr-auto inline-flex items-center gap-1 font-bold text-gold-600"><ExternalLink size={13} />المنشور</a>}
      </header>
      <p className="text-[15px] leading-7 text-navy-950"><b className="ltr ml-1 text-navy-700">{c.username ? `@${c.username}` : ''}</b> {c.text}</p>
      {c.summary && <p className="mt-1 text-xs text-slate-500">🧭 {c.summary}</p>}
      {c.status === 'REPLIED' ? (
        <p className="mt-3 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800"><Check size={14} className="inline" /> تم الرد: {c.repliedText}</p>
      ) : c.status === 'IGNORED' ? (
        <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-50 p-2 text-xs text-slate-500">أُغلق بدون رد <button className="font-bold underline" onClick={() => run(async () => { await apiCall(`/api/comments/${c.id}`, { method: 'PATCH', body: { status: 'NEW' } }); return 'أُعيد فتحه'; })}>إعادة فتح</button></div>
      ) : (
        <div className="mt-3 space-y-2">
          {c.category !== 'spam' && <>
            <label className="sr-only" htmlFor={`r-${c.id}`}>الرد</label>
            <textarea id={`r-${c.id}`} rows={4} maxLength={600} className="input text-sm leading-6" value={reply} onChange={(e) => setReply(e.target.value)} />
          </>}
          <div className="flex flex-wrap gap-2">
            {c.category !== 'spam' && (graph && canSend
              ? <Button type="button" size="sm" disabled={busy || !reply.trim()} onClick={() => run(async () => { await apiCall(`/api/comments/${c.id}/reply`, { body: { text: reply } }); return 'أُرسل الرد على انستغرام ✓'; })}><Send size={15} />إرسال الرد</Button>
              : <>
                  <Button type="button" size="sm" variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(reply); setCopied(true); } catch { setCopied(false); } }}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'نُسخ' : 'نسخ الرد'}</Button>
                  <Button type="button" size="sm" disabled={busy || !reply.trim()} onClick={() => run(async () => { await apiCall(`/api/comments/${c.id}/reply`, { body: { text: reply } }); return 'سُجّل كمردود عليه ✓'; })}><Check size={15} />رددت عليه</Button>
                </>)}
            {c.category === 'spam' && graph && canSend && <Button type="button" size="sm" variant="danger" disabled={busy} onClick={() => run(async () => { await apiCall(`/api/comments/${c.id}/hide`, { body: {} }); return 'أُخفي التعليق ✓'; })}><EyeOff size={15} />إخفاء من انستغرام</Button>}
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => run(async () => { await apiCall(`/api/comments/${c.id}`, { method: 'PATCH', body: { status: 'IGNORED' } }); return 'أُغلق'; })}>لا يحتاج رد</Button>
          </div>
        </div>
      )}
      {msg && <p role="status" className={`mt-2 text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.t}</p>}
    </article>
  );
}

export function SyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" disabled={busy} onClick={async () => {
        setBusy(true); setMsg(null);
        try { const r = await apiCall<{ added: number; unmatched?: string[]; errors?: string[] }>('/api/comments/sync', { body: {} }); setMsg(`✓ ${r.added} تعليق جديد${r.unmatched?.length ? ` · حسابات غير مطابقة: ${r.unmatched.join('، ')}` : ''}${r.errors?.length ? ` · أخطاء: ${r.errors.length}` : ''}`); router.refresh(); }
        catch (x) { setMsg((x as Error).message); }
        setBusy(false);
      }}><RefreshCw size={15} className={busy ? 'animate-spin' : ''} />{busy ? 'جارٍ الجلب…' : 'جلب التعليقات الآن'}</Button>
      {msg && <span className="text-xs text-slate-600">{msg}</span>}
    </div>
  );
}

export function ImportBox({ accounts }: { accounts: { id: string; name: string }[] }) {
  const router = useRouter();
  const [acc, setAcc] = useState(accounts[0]?.id ?? '');
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2 text-sm">
      <p className="text-slate-600">بدون ربط: انسخ التعليقات من انستغرام والصقها هنا — <b>كل تعليق في سطر</b>، ويمكن كتابة الاسم قبله: <span className="ltr">sara.bh: بكم الكوب؟</span></p>
      <select className="input" value={acc} onChange={(e) => setAcc(e.target.value)} aria-label="الحساب">{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
      <textarea className="input" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={'sara.bh: بكم الكوب؟\nali_99: ماشاءالله روعة 😍'} aria-label="التعليقات" />
      <Button type="button" size="sm" disabled={busy || !text.trim() || !acc} onClick={async () => {
        setBusy(true); setMsg(null);
        try { const r = await apiCall<{ imported: number }>('/api/comments/import', { body: { accountId: acc, text } }); setMsg({ ok: true, t: `✓ أُضيف ${r.imported} تعليقًا وحُلّل` }); setText(''); router.refresh(); }
        catch (x) { setMsg({ ok: false, t: (x as Error).message }); }
        setBusy(false);
      }}>تحليل التعليقات</Button>
      {msg && <p className={msg.ok ? 'text-emerald-700' : 'text-red-700'}>{msg.t}</p>}
    </div>
  );
}

export function TokenCard({ configured }: { configured: boolean }) {
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [saved, setSaved] = useState(configured);
  return (
    <div className="space-y-3 text-sm">
      <ol className="list-decimal space-y-1 pr-5 text-slate-600">
        <li>في <span className="ltr">business.facebook.com/settings</span> ← مستخدمو النظام ← مستخدمك ← «تعيين الأصول»: أضف <b>صفحات فيسبوك</b> المرتبطة بحسابات انستغرام.</li>
        <li>«إنشاء رمز جديد» ← المدة: <b>أبدًا</b> ← الصلاحيات: <span className="ltr text-xs">instagram_basic · instagram_manage_comments · pages_show_list · pages_read_engagement · business_management</span></li>
        <li>الصق الرمز هنا ← حفظ ← اختبار.</li>
      </ol>
      <div className="flex flex-wrap gap-2">
        <input className="input ltr max-w-md" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={saved ? '•••••• محفوظ (مشفّر)' : 'EAA…'} aria-label="رمز Meta" />
        <Button type="button" size="sm" disabled={!token.trim()} onClick={async () => { try { await apiCall('/api/comments/token', { method: 'PUT', body: { token } }); setToken(''); setSaved(true); setMsg({ ok: true, t: 'حُفظ ✓' }); } catch (x) { setMsg({ ok: false, t: (x as Error).message }); } }}>حفظ</Button>
        <Button type="button" size="sm" variant="outline" disabled={!saved} onClick={async () => { try { const r = await apiCall<{ ok: boolean; message: string }>('/api/comments/token', { body: {} }); setMsg({ ok: r.ok, t: r.message }); } catch (x) { setMsg({ ok: false, t: (x as Error).message }); } }}>اختبار</Button>
      </div>
      {msg && <p className={msg.ok ? 'text-emerald-700' : 'text-red-700'}>{msg.t}</p>}
      <p className="text-xs text-slate-500">لا يُنشر أي رد تلقائيًا — كل رد يُرسل بضغطة منك. الردود المقترحة لا تحتوي أسعارًا أو خصومات أو وعودًا، والأرقام الوحيدة فيها أرقام فرعيك.</p>
    </div>
  );
}
