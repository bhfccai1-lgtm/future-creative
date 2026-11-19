'use client';
import { useEffect, useRef, useState } from 'react';
import { apiCall } from '@/lib/client/api';
import type { AssistantReply, ChatTurn, Proposal } from '@/lib/assistant/agent';
import { Button } from './ui';

type Msg = ChatTurn & { proposal?: Proposal | null; done?: string };
const EXAMPLES = ['شنو وضع النظام اليوم؟', 'أي حساب أداؤه أفضل وليش؟', 'كم تصميم ينتظر موافقتي؟', 'صمم ريل لحساب الأكواب عن العيد الوطني', 'اعتمد أفكار خطة حساب الاستيكرات'];

export function AssistantChat() {
  const [msgs, setMsgs] = useState<Msg[]>([{ role: 'assistant', content: 'هلا والله 👋 أنا مساعد إبداع المستقبل. اسألني عن الحسابات والنظام، أو اطلب تصميمًا — وما أنفّذ أي شيء إلا بعد ما تضغط «تأكيد».' }]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs]);
  const send = async (t = text) => {
    const q = t.trim(); if (!q || busy) return;
    const history: ChatTurn[] = msgs.slice(1).map(({ role, content }) => ({ role, content }));
    setMsgs((m) => [...m, { role: 'user', content: q }]); setText(''); setBusy(true);
    try {
      const r = await apiCall<AssistantReply>('/api/assistant', { body: { message: q, history } });
      setMsgs((m) => [...m, { role: 'assistant', content: r.reply, proposal: r.proposal }]);
    } catch (e) { setMsgs((m) => [...m, { role: 'assistant', content: `⚠️ ${(e as Error).message}` }]); }
    finally { setBusy(false); }
  };
  const confirm = async (i: number, p: Proposal) => {
    setBusy(true);
    try { const r = await apiCall<{ message: string }>('/api/assistant/confirm', { body: { proposal: p } }); setMsgs((m) => m.map((x, k) => (k === i ? { ...x, done: r.message } : x))); }
    catch (e) { setMsgs((m) => m.map((x, k) => (k === i ? { ...x, done: `⚠️ ${(e as Error).message}` } : x))); }
    finally { setBusy(false); }
  };
  return (
    <div className="card flex min-h-[70vh] flex-col p-0">
      <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
        {msgs.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-start' : 'flex justify-end'}>
            <div className={`max-w-[85%] whitespace-pre-line rounded-2xl px-4 py-2.5 text-sm leading-7 ${m.role === 'user' ? 'bg-navy-800 text-white' : 'bg-slate-100 text-slate-900'}`}>
              {m.content}
              {m.proposal && (
                <div className="mt-2 rounded-xl border border-gold-500 bg-white p-3 text-slate-900">
                  <div className="text-xs font-bold text-slate-500">اقتراح بانتظار تأكيدك</div>
                  <p className="my-1">{m.proposal.summary}</p>
                  {m.done ? <p className="text-xs font-bold text-emerald-700">{m.done}</p> : (
                    <div className="flex gap-2"><Button size="sm" variant="gold" disabled={busy} onClick={() => confirm(i, m.proposal!)}>تأكيد</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => setMsgs((x) => x.map((y, k) => (k === i ? { ...y, done: 'أُلغي — لم يُنفَّذ شيء.' } : y)))}>إلغاء</Button></div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && <div className="flex justify-end"><div className="rounded-2xl bg-slate-100 px-4 py-2.5 text-sm text-slate-500">يفكّر…</div></div>}
        <div ref={end} />
      </div>
      {msgs.length <= 1 && <div className="flex flex-wrap gap-1.5 border-t px-4 pt-3">{EXAMPLES.map((e) => <button key={e} type="button" className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-bold hover:border-gold-500" onClick={() => send(e)}>{e}</button>)}</div>}
      <form className="flex gap-2 border-t p-3" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <label htmlFor="assistant-input" className="sr-only">رسالتك</label>
        <input id="assistant-input" className="input flex-1" value={text} maxLength={1500} onChange={(e) => setText(e.target.value)} placeholder="اكتب طلبك… مثال: صمم ستوري لحساب المناسبات عن لوحات الترحيب" autoComplete="off" />
        <Button disabled={busy || !text.trim()}>إرسال</Button>
      </form>
    </div>
  );
}
