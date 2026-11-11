'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiCall } from '@/lib/client/api';
import { Button } from './ui';

type S = { publishingMode: string; schedulerMode: string; modeBPostsPerHour: number; modeBAccountIds: string[]; autoPublishGlobal: boolean; killSwitch: boolean };

export function AutomationControls({ s, accounts }: { s: S; accounts: { id: string; name: string; eligible: boolean }[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [mode, setMode] = useState(s.schedulerMode);
  const [perHour, setPerHour] = useState(s.modeBPostsPerHour);
  const [sel, setSel] = useState<string[]>(s.modeBAccountIds);
  const call = async (body: Record<string, unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setMsg(null);
    try { await apiCall('/api/automation', { body }); setMsg({ ok: true, t: 'تم الحفظ وتأكيده من الخادم ✓' }); router.refresh(); }
    catch (e) { setMsg({ ok: false, t: (e as Error).message }); }
  };
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        {s.autoPublishGlobal
          ? <Button variant="outline" size="lg" onClick={() => call({ action: 'stop' })}>إيقاف النشر الآلي</Button>
          : <Button variant="success" size="lg" disabled={s.killSwitch} onClick={() => call({ action: 'start' }, 'تشغيل المجدول للحسابات المسموح لها فقط؟')}>تشغيل النشر الآلي</Button>}
        {s.killSwitch
          ? <Button variant="outline" size="lg" onClick={() => call({ action: 'release_kill' }, 'إلغاء الإيقاف الطارئ؟ لن يُعاد تشغيل النشر الآلي تلقائيًا.')}>إلغاء الإيقاف الطارئ</Button>
          : <Button variant="danger" size="lg" onClick={() => { const r = window.prompt('سبب الإيقاف الطارئ:'); if (r !== null) call({ action: 'kill', reason: r }); }}>⛔ إيقاف طارئ فوري</Button>}
      </div>

      <div>
        <h3 className="mb-2 font-bold">وضع النشر</h3>
        <div className="grid gap-3 md:grid-cols-3">
          {[
            ['MANUAL', 'يدوي', 'توليد التصاميم ثم موافقة ونشر يدوي.'],
            ['ASSISTED', 'مساعد', 'توليد وفحص آلي، والموافقة مطلوبة قبل الجدولة.'],
            ['AUTONOMOUS', 'ذاتي', 'توليد وفحص وجدولة ونشر آلي للحسابات المفوّضة فقط.'],
          ].map(([v, l, d]) => (
            <button key={v} className={`rounded-xl border-2 p-4 text-right ${s.publishingMode === v ? 'border-gold-500 bg-gold-300/20' : 'border-slate-200 hover:border-slate-300'}`}
              onClick={() => {
                if (v === s.publishingMode) return;
                if (v === 'AUTONOMOUS') { const c = window.prompt('اكتب عبارة التأكيد بالضبط: أوافق على النشر الذاتي'); if (c) call({ action: 'publishing_mode', mode: v, confirm: c }); }
                else call({ action: 'publishing_mode', mode: v });
              }}>
              <div className="font-extrabold">{l}</div><div className="text-xs text-slate-600">{d}</div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-2 font-bold">نمط المجدول (يستيقظ كل 60 دقيقة بتوقيت البحرين)</h3>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="radio" checked={mode === 'A_PER_ACCOUNT_HOURLY'} onChange={() => setMode('A_PER_ACCOUNT_HOURLY')} /> النمط A — كل حساب مفعّل ينشر حسب فترته الخاصة (افتراضيًا كل 7 ساعات، ضمن نافذة النشر)</label>
          <label className="flex items-center gap-2"><input type="radio" checked={mode === 'B_FIXED_PER_HOUR'} onChange={() => setMode('B_FIXED_PER_HOUR')} /> النمط B — عدد محدد من الإعلانات كل ساعة عبر حسابات مختارة</label>
        </div>
        {mode === 'B_FIXED_PER_HOUR' && (
          <div className="mt-3 rounded-lg border p-3">
            <label className="label">عدد الإعلانات في الساعة</label>
            <input type="number" min={1} max={100} className="input mb-3 w-32" value={perHour} onChange={(e) => setPerHour(Number(e.target.value))} />
            <div className="grid grid-cols-2 gap-1 md:grid-cols-3">
              {accounts.map((a) => <label key={a.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sel.includes(a.id)} onChange={(e) => setSel(e.target.checked ? [...sel, a.id] : sel.filter((x) => x !== a.id))} />{a.name}{!a.eligible && <span className="text-xs text-amber-600">(غير مرتبط/غير مفعّل)</span>}</label>)}
            </div>
          </div>
        )}
        <Button className="mt-3" onClick={() => call({ action: 'scheduler_mode', mode, postsPerHour: perHour, accountIds: sel })}>حفظ نمط المجدول</Button>
      </div>
      {msg && <p className={msg.ok ? 'text-sm text-emerald-700' : 'rounded bg-red-50 p-2 text-sm text-red-700'}>{msg.t}</p>}
    </div>
  );
}
