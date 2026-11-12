'use client';
import { useState } from 'react';
import { apiCall } from '@/lib/client/api';
import { Button } from './ui';

type Growth = { peakHours: { enabled: boolean; maxDelayHours: number; count: number }; winners: { enabled: boolean; minMultiple: number; maxPerWeek: number } };
type Peak = { id: string; name: string; hours: number[]; source: 'data' | 'default'; sample: number };
type Win = { adId: string; account: string; headline: string | null; format: string; reach: number; medianReach: number; multiple: number; sendsSaves: number; reason: string; publicUrl: string | null; boosted: boolean };
export type GrowthStatus = { growth: Growth; peaks: Peak[]; winners: Win[] };

const FORMAT_AR: Record<string, string> = { REEL_VIDEO: 'ريلز', IMAGE_FEED: 'منشور', IMAGE_SQUARE: 'منشور', IMAGE_CAROUSEL: 'كاروسيل', IMAGE_STORY: 'ستوري' };

export function GrowthSettings({ initial }: { initial: GrowthStatus }) {
  const [st, setSt] = useState(initial);
  const [g, setG] = useState(initial.growth);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<string>) => { setBusy(true); setMsg(null); try { setMsg({ ok: true, t: await f() }); } catch (x) { setMsg({ ok: false, t: (x as Error).message }); } finally { setBusy(false); } };
  const save = () => run(async () => { const r = await apiCall<GrowthStatus>('/api/settings/growth', { method: 'PUT', body: g }); setSt(r); return 'تم الحفظ ✓'; });
  const boost = () => run(async () => { const r = await apiCall<{ boosted: string[]; status: GrowthStatus }>('/api/settings/growth', { method: 'POST', body: {} }); setSt(r.status); return r.boosted.length ? `✓ أُرسل ${r.boosted.length} ريلز جديدة للتوليد (تمر بالموافقة المعتادة)` : 'لا يوجد ناجح جديد، أو بلغت الحد الأسبوعي'; });
  return (
    <div className="space-y-6 text-sm">
      <section className="space-y-3">
        <h3 className="text-base font-extrabold">⏰ النشر في ساعات الذروة</h3>
        <p className="text-slate-600">يتعلم النظام من <b>وصولك الحقيقي</b> (مقاييس Metricool) أفضل ساعات كل حساب. إذا حان موعد منشور في ساعة ضعيفة وكانت ساعة ذروة قريبة داخل نافذة الحساب، ينتظرها. قبل توفر 12 منشورًا مقاسًا يُستخدم ترتيب الذروة من بيانات Metricool لجمهورك (10، 11، 12، 18…).</p>
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex items-center gap-2 font-bold"><input type="checkbox" checked={g.peakHours.enabled} onChange={(e) => setG({ ...g, peakHours: { ...g.peakHours, enabled: e.target.checked } })} /> تفعيل ساعات الذروة</label>
          <div><label className="label">أقصى انتظار (ساعات)</label><input type="number" min={1} max={6} className="input" style={{ width: '6rem' }} value={g.peakHours.maxDelayHours} onChange={(e) => setG({ ...g, peakHours: { ...g.peakHours, maxDelayHours: Number(e.target.value) } })} /></div>
          <div><label className="label">عدد ساعات الذروة يوميًا</label><input type="number" min={2} max={10} className="input" style={{ width: '6rem' }} value={g.peakHours.count} onChange={(e) => setG({ ...g, peakHours: { ...g.peakHours, count: Number(e.target.value) } })} /></div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px]"><thead><tr><th className="th">الحساب</th><th className="th">ساعات الذروة (البحرين)</th><th className="th">المصدر</th></tr></thead>
            <tbody>{st.peaks.map((p) => (
              <tr key={p.id} className="border-t"><td className="td font-bold">{p.name}</td><td className="td ltr">{[...p.hours].sort((a, b) => a - b).map((h) => `${h}:00`).join('  ')}</td>
                <td className="td text-xs">{p.source === 'data' ? <span className="text-emerald-700">من بياناتك ({p.sample} منشور)</span> : <span className="text-slate-500">افتراضي ({p.sample}/12 منشور مقاس)</span>}</td></tr>))}</tbody></table>
        </div>
      </section>

      <section className="space-y-3 border-t pt-4">
        <h3 className="text-base font-extrabold">🚀 ضاعف الناجح</h3>
        <p className="text-slate-600">كل أحد 10:15 صباحًا يبحث النظام عن المنشورات التي تفوقت بوضوح على حسابها (وصول ≥ المضاعف × متوسط الحساب خلال 30 يومًا، أو أعلى حفظ ومشاركة)، ويولّد لكل منها <b>ريلز جديدة</b> بنفس المنتج والزاوية وبتصميم وعنوان مختلفين. الريلز تصل لغير المتابعين. تمر بالموافقة/التفويض المعتاد وفحص التكرار — لا إعادة نشر ولا نسخ.</p>
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex items-center gap-2 font-bold"><input type="checkbox" checked={g.winners.enabled} onChange={(e) => setG({ ...g, winners: { ...g.winners, enabled: e.target.checked } })} /> تفعيل «ضاعف الناجح» أسبوعيًا</label>
          <div><label className="label">المضاعف (× متوسط الوصول)</label><input type="number" step={0.1} min={1.2} max={10} className="input" style={{ width: '6rem' }} value={g.winners.minMultiple} onChange={(e) => setG({ ...g, winners: { ...g.winners, minMultiple: Number(e.target.value) } })} /></div>
          <div><label className="label">الحد الأسبوعي</label><input type="number" min={1} max={14} className="input" style={{ width: '6rem' }} value={g.winners.maxPerWeek} onChange={(e) => setG({ ...g, winners: { ...g.winners, maxPerWeek: Number(e.target.value) } })} /></div>
        </div>
        {st.winners.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px]"><thead><tr><th className="th">الحساب</th><th className="th">المنشور</th><th className="th">الوصول</th><th className="th">السبب</th><th className="th"></th></tr></thead>
              <tbody>{st.winners.map((w) => (
                <tr key={w.adId} className="border-t"><td className="td font-bold">{w.account}</td>
                  <td className="td">{w.publicUrl ? <a className="underline" href={w.publicUrl} target="_blank" rel="noopener noreferrer">{w.headline ?? '—'}</a> : (w.headline ?? '—')} <span className="text-xs text-slate-500">({FORMAT_AR[w.format] ?? w.format})</span></td>
                  <td className="td">{w.reach.toLocaleString('en')} <span className="text-xs text-slate-500">/ متوسط {w.medianReach.toLocaleString('en')}</span></td>
                  <td className="td text-xs">{w.reason}</td><td className="td text-xs">{w.boosted ? <span className="text-emerald-700">✓ ضوعف</span> : 'بانتظار'}</td></tr>))}</tbody></table>
          </div>
        ) : <p className="text-slate-500">لا توجد منشورات متفوقة بعد — تحتاج 5 منشورات مقاسة على الأقل لكل حساب (استورد المقاييس من التقارير).</p>}
        <Button type="button" variant="outline" disabled={busy || !st.winners.some((w) => !w.boosted)} onClick={boost}>ضاعف الناجح الآن</Button>
      </section>

      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        <Button type="button" disabled={busy} onClick={save}>حفظ إعدادات الانتشار</Button>
        {msg && <span className={msg.ok ? 'text-emerald-700' : 'text-red-700'}>{msg.t}</span>}
      </div>
    </div>
  );
}
