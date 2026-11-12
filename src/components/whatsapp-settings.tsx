'use client';
import Link from 'next/link';
import { useState } from 'react';
import { apiCall } from '@/lib/client/api';
import { Button } from './ui';

type Catalog = { enabled: boolean; catalogId: string; categoryIds: string[]; autoSyncDaily: boolean; lastSyncAt: string | null; lastSyncOk: boolean; lastSyncMessage: string | null };
type Pack = { enabled: boolean; maxPerDay: number; accountIds: string[] };
type Plan = { total: number; ready: number; missingPrice: number; missingImage: number; missingPriceSample: string[]; missingImageSample: string[] } | null;
export type WhatsappStatus = { catalog: Catalog; statusPack: Pack; token: boolean; telegram: boolean; plan: Plan };

export function WhatsappSettings({ initial, categories, accounts }: { initial: WhatsappStatus; categories: { id: string; nameAr: string }[]; accounts: { id: string; name: string }[] }) {
  const [st, setSt] = useState(initial);
  const [cat, setCat] = useState(initial.catalog);
  const [pack, setPack] = useState(initial.statusPack);
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<string>) => { setBusy(true); setMsg(null); try { setMsg({ ok: true, t: await f() }); } catch (x) { setMsg({ ok: false, t: (x as Error).message }); } finally { setBusy(false); } };
  const save = () => run(async () => {
    const r = await apiCall<WhatsappStatus>('/api/settings/whatsapp', { method: 'PUT', body: { catalog: { enabled: cat.enabled, catalogId: cat.catalogId, categoryIds: cat.categoryIds, autoSyncDaily: cat.autoSyncDaily }, statusPack: pack, ...(token.trim() ? { token: token.trim() } : {}) } });
    setSt(r); setToken(''); return 'تم الحفظ ✓';
  });
  const act = (action: 'test' | 'sync' | 'status_test') => run(async () => {
    const r = await apiCall<{ name?: string; productCount?: number; sent?: number }>('/api/settings/whatsapp', { method: 'POST', body: { action } });
    if (action === 'test') return `✓ الكتالوج «${r.name}» — فيه الآن ${r.productCount} منتج`;
    if (action === 'sync') return '✓ بدأت المزامنة في الخلفية — حدّث الصفحة بعد دقيقة لترى النتيجة';
    return `✓ أُرسلت حزمة حالة إلى تيليجرام (${r.sent})`;
  });
  const toggle = (arr: string[], id: string) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);
  const p = st.plan;
  return (
    <div className="space-y-6 text-sm">
      <section className="space-y-3">
        <h3 className="text-base font-extrabold">كتالوج واتساب (رسمي عبر Meta)</h3>
        <p className="text-slate-600">تُرسل منتجاتك إلى كتالوج Meta المرتبط برقم واتساب للأعمال، ويتحدث يوميًا تلقائيًا. يُرسل فقط المنتج الذي له <b>سعر يبدأ من</b> و<b>تصميم معتمد</b> (شرطان من Meta)، ويُزال من الكتالوج كل منتج متوقف. رابط كل منتج يفتح صفحة عامة فيها أزرار واتساب للفرعين.</p>
        {p && (
          <div className="grid gap-2 sm:grid-cols-4">
            <div className="rounded-lg border p-2"><div className="text-xs text-slate-500">منتجات في النطاق</div><b className="text-lg">{p.total}</b></div>
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-2"><div className="text-xs text-slate-500">جاهزة للكتالوج</div><b className="text-lg">{p.ready}</b></div>
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-2"><div className="text-xs text-slate-500">بلا سعر</div><b className="text-lg">{p.missingPrice}</b>{p.missingPriceSample.length > 0 && <div className="text-xs text-slate-500">{p.missingPriceSample.join('، ')}…</div>}</div>
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-2"><div className="text-xs text-slate-500">بلا تصميم معتمد</div><b className="text-lg">{p.missingImage}</b>{p.missingImageSample.length > 0 && <div className="text-xs text-slate-500">{p.missingImageSample.join('، ')}…</div>}</div>
          </div>
        )}
        {p && p.missingPrice > 0 && <p className="text-xs text-slate-600">أضف الأسعار من <Link className="font-bold underline" href="/products">المنتجات</Link> (حقل «السعر يبدأ من»)، أو دفعة واحدة: صدّر ملف CSV ← املأ عمود <span className="ltr">price</span> ← استورده.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label">رقم الكتالوج (Catalog ID)</label><input className="input ltr" inputMode="numeric" value={cat.catalogId} onChange={(e) => setCat({ ...cat, catalogId: e.target.value.replace(/\D/g, '') })} placeholder="مثل 1234567890123456" /></div>
          <div><label className="label">رمز الوصول من Meta {st.token ? <span className="text-emerald-700">(محفوظ مشفّرًا ✓)</span> : <span className="text-amber-700">(غير محفوظ)</span>}</label>
            <input className="input ltr" type="password" autoComplete="new-password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={st.token ? 'اتركه فارغًا للإبقاء على المحفوظ' : 'الصق الرمز هنا (يبدأ بـ EA)'} /></div>
        </div>
        <div><label className="label">الفئات المعروضة في الكتالوج (بدون اختيار = كل المنتجات النشطة)</label>
          <div className="flex flex-wrap gap-1">{categories.map((c) => { const on = cat.categoryIds.includes(c.id); return <button key={c.id} type="button" onClick={() => setCat({ ...cat, categoryIds: toggle(cat.categoryIds, c.id) })} className={`rounded-full border px-2 py-0.5 text-xs ${on ? 'border-navy-800 bg-navy-800 text-white' : 'bg-white'}`}>{c.nameAr}</button>; })}</div></div>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 font-bold"><input type="checkbox" checked={cat.enabled} onChange={(e) => setCat({ ...cat, enabled: e.target.checked })} /> تفعيل مزامنة الكتالوج</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={cat.autoSyncDaily} onChange={(e) => setCat({ ...cat, autoSyncDaily: e.target.checked })} /> مزامنة يومية تلقائية (4:10 فجرًا)</label>
        </div>
        {st.catalog.lastSyncAt && <p className={st.catalog.lastSyncOk ? 'text-emerald-700' : 'text-red-700'}>آخر مزامنة {new Date(st.catalog.lastSyncAt).toLocaleString('ar-BH')}: {st.catalog.lastSyncMessage}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={busy || !st.token || !st.catalog.catalogId} onClick={() => act('test')}>اختبار الربط</Button>
          <Button type="button" variant="outline" disabled={busy || !st.token || !st.catalog.catalogId} onClick={() => act('sync')}>مزامنة الآن</Button>
        </div>
      </section>

      <section className="space-y-3 border-t pt-4">
        <h3 className="text-base font-extrabold">حزمة حالة واتساب (Status)</h3>
        <p className="text-slate-600">واتساب لا يسمح رسميًا بالنشر الآلي في الحالة، والأدوات غير الرسمية قد تحظر رقمك — لذلك يرسل النظام إلى <b>تيليجرام</b> أفضل منشوراتك المؤكدة (الريلز أولًا) مع نص جاهز للنسخ، منشورًا واحدًا كل ساعة بين 9 صباحًا و9 مساءً حتى الحد اليومي. أنت تنشرها من هاتفك في ثوانٍ.</p>
        {!st.telegram && <p className="text-amber-700">يحتاج بوت تيليجرام ورقم المحادثة — من إعدادات n8n في هذه الصفحة.</p>}
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex items-center gap-2 font-bold"><input type="checkbox" checked={pack.enabled} onChange={(e) => setPack({ ...pack, enabled: e.target.checked })} /> تفعيل حزمة الحالة</label>
          <div><label className="label">العدد في اليوم</label><input type="number" min={1} max={10} className="input" style={{ width: '6rem' }} value={pack.maxPerDay} onChange={(e) => setPack({ ...pack, maxPerDay: Number(e.target.value) })} /></div>
        </div>
        <div><label className="label">من منشورات الحسابات (بدون اختيار = كل الحسابات)</label>
          <div className="flex flex-wrap gap-1">{accounts.map((a) => { const on = pack.accountIds.includes(a.id); return <button key={a.id} type="button" onClick={() => setPack({ ...pack, accountIds: toggle(pack.accountIds, a.id) })} className={`rounded-full border px-2 py-0.5 text-xs ${on ? 'border-navy-800 bg-navy-800 text-white' : 'bg-white'}`}>{a.name}</button>; })}</div></div>
        <Button type="button" variant="outline" disabled={busy || !st.telegram} onClick={() => act('status_test')}>أرسل حزمة الآن (تجربة)</Button>
      </section>

      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        <Button type="button" disabled={busy} onClick={save}>حفظ إعدادات واتساب</Button>
        {msg && <span className={msg.ok ? 'text-emerald-700' : 'text-red-700'}>{msg.t}</span>}
      </div>
    </div>
  );
}
