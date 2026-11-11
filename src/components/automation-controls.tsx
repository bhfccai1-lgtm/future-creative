'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiCall } from '@/lib/client/api';
import { Button } from './ui';

type S = { publishingMode: string; schedulerMode: string; modeBPostsPerHour: number; modeBAccountIds: string[]; autoPublishGlobal: boolean; killSwitch: boolean };

type Acc = { id: string; name: string; eligible: boolean; reason: string | null; connected: boolean; everyHours: number; autonomous: boolean };
export function AutomationControls({ s, accounts }: { s: S; accounts: Acc[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [mode, setMode] = useState(s.schedulerMode);
  const [perHour, setPerHour] = useState(s.modeBPostsPerHour);
  const [sel, setSel] = useState<string[]>(s.modeBAccountIds);
  const [allow, setAllow] = useState<string[]>(accounts.filter((a) => a.eligible).map((a) => a.id));
  const [hours, setHours] = useState<number>(7);
  const call = async (body: Record<string, unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setMsg(null);
    try {
      const r = await apiCall<{ changed?: number; skipped?: { name: string; reason: string }[]; warning?: string }>('/api/automation', { body });
      setMsg({ ok: !r.skipped?.length && !r.warning, t: r.changed !== undefined ? `تم تحديث ${r.changed} حساب ✓${r.skipped?.length ? ` · لم يُطبّق على: ${r.skipped.map((x) => `${x.name} (${x.reason})`).join('، ')}` : ''}${r.warning ? ` · ${r.warning}` : ''}` : 'تم الحفظ وتأكيده من الخادم ✓' });
      router.refresh();
    }
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

      <div className="rounded-xl border border-gold-300 bg-gold-300/10 p-4">
        <h3 className="mb-1 font-bold">الحسابات المسموح لها بالنشر الآلي ({accounts.filter((a) => a.eligible).length} من {accounts.length})</h3>
        <p className="mb-3 text-xs text-slate-600">ضع علامة على الحسابات ثم اضغط «السماح بالنشر الآلي». الحسابات غير المرتبطة بـ Metricool لا تُفعّل (يظهر السبب).</p>
        <div className="mb-3 grid grid-cols-1 gap-1 sm:grid-cols-2 md:grid-cols-3">
          {accounts.map((a) => <label key={a.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={allow.includes(a.id)} onChange={(e) => setAllow(e.target.checked ? [...allow, a.id] : allow.filter((x) => x !== a.id))} />{a.name}{a.eligible ? <span className="text-xs text-emerald-700">✓ مفعّل</span> : a.reason && <span className={`text-xs ${a.connected ? 'text-sky-700' : 'text-amber-600'}`}>({a.reason})</span>}<span className="text-[11px] text-slate-500">كل {a.everyHours} س{a.autonomous ? ' · بدون موافقة' : ' · بموافقتك'}</span></label>)}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" type="button" onClick={() => setAllow(accounts.filter((a) => a.connected).map((a) => a.id))}>تحديد كل المرتبطة</Button>
          <Button size="sm" variant="success" type="button" disabled={!allow.length} onClick={() => call({ action: 'enable_accounts', accountIds: allow, enabled: true }, `السماح بالنشر الآلي لـ ${allow.length} حساب؟ (سيُولَّد تصميم لكل حساب حسب فترته — كل 7 ساعات افتراضيًا)`)}>السماح بالنشر الآلي للمحدد</Button>
          <Button size="sm" variant="outline" type="button" disabled={!allow.length} onClick={() => call({ action: 'enable_accounts', accountIds: allow, enabled: false })}>إيقاف المحدد</Button>
        </div>
        <div className="mt-4 grid gap-3 border-t pt-3 md:grid-cols-2">
          <div>
            <div className="mb-1 text-sm font-bold">كل كم ساعة ينشر كل حساب محدد؟</div>
            <div className="flex flex-wrap items-center gap-2">
              {[5, 7, 9].map((h) => <Button key={h} size="sm" type="button" variant={hours === h ? 'gold' : 'outline'} onClick={() => setHours(h)}>كل {h} ساعات</Button>)}
              <input type="number" min={1} max={168} className="input" style={{ width: '5.5rem' }} value={hours} onChange={(e) => setHours(Number(e.target.value))} aria-label="عدد الساعات" />
              <Button size="sm" type="button" disabled={!allow.length || !hours} onClick={() => call({ action: 'account_settings', accountIds: allow, intervalHours: hours })}>تطبيق</Button>
            </div>
            <p className="mt-1 text-xs text-slate-500">ضمن نافذة النشر لكل حساب (افتراضيًا 9 صباحًا – 10 مساءً). كل {hours} ساعات ≈ {Math.max(1, Math.floor(13 / hours) + 1)} منشور يوميًا للحساب.</p>
          </div>
          <div>
            <div className="mb-1 text-sm font-bold">النشر بدون موافقتي</div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" type="button" variant="danger" disabled={!allow.length} onClick={() => call({ action: 'account_settings', accountIds: allow, autonomous: true }, `سيُنشر ما يجتاز فحص الجودة لـ ${allow.length} حساب دون موافقتك. التصاميم التي يرسم فيها الذكاء الاصطناعي النص تبقى بحاجة لموافقتك (يمكن تغييره من إعدادات الذكاء الاصطناعي). متابعة؟`)}>نشر بدون موافقة للمحدد</Button>
              <Button size="sm" type="button" variant="outline" disabled={!allow.length} onClick={() => call({ action: 'account_settings', accountIds: allow, autonomous: false })}>إرجاع للموافقة اليدوية</Button>
            </div>
            <p className="mt-1 text-xs text-slate-500">يتطلب «وضع النشر = ذاتي» أدناه. الإيقاف الطارئ والفحوص (الشعار، الأرقام، البصمة) تبقى فعّالة دائمًا.</p>
          </div>
        </div>
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
              {accounts.map((a) => <label key={a.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sel.includes(a.id)} onChange={(e) => setSel(e.target.checked ? [...sel, a.id] : sel.filter((x) => x !== a.id))} />{a.name}{a.reason && <span className={`text-xs ${a.connected ? 'text-sky-700' : 'text-amber-600'}`}>({a.reason})</span>}</label>)}
            </div>
          </div>
        )}
        <Button className="mt-3" onClick={() => call({ action: 'scheduler_mode', mode, postsPerHour: perHour, accountIds: sel })}>حفظ نمط المجدول</Button>
      </div>
      {msg && <p className={msg.ok ? 'text-sm text-emerald-700' : 'rounded bg-red-50 p-2 text-sm text-red-700'}>{msg.t}</p>}
    </div>
  );
}
