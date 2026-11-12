'use client';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { apiCall } from '@/lib/client/api';
import { Button } from './ui';
import { CONTENT_TYPES, LANGUAGES, MARKETS, OCCASIONS, SEGMENTS } from '@/lib/creative/options';
import { bestHoursFor, previewSlots } from '@/lib/campaigns/slots';
import { DesignFields, designDirection, EMPTY_DESIGN, type DesignValues } from './design-fields';

type Opt = { id: string; label: string; categoryId?: string };
const TZ = 'Asia/Bahrain';
const DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const INTERVALS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 24, 48, 72, 168];
const intervalLabel = (h: number) => (h < 24 ? `كل ${h} ${h === 1 ? 'ساعة' : h <= 10 ? 'ساعات' : 'ساعة'}` : h === 24 ? 'كل يوم' : h === 168 ? 'كل أسبوع' : `كل ${h / 24} أيام`);
const nowLocal = () => formatInTimeZone(new Date(Date.now() + 3600_000), TZ, "yyyy-MM-dd'T'HH:00");

function Sel({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return <div><label className="label">{label}</label><select className="input" value={value} onChange={(e) => onChange(e.target.value)}>{children}</select></div>;
}

export interface CampaignInitial {
  id: string; name: string; accountIds: string[]; productId: string | null; format: string | null; language: string | null; direction: Record<string, unknown> | null;
  scheduleType: string; everyHours: number; daysOfWeek: number[]; timeMode: string; startAt: string; endAt: string | null; maxRuns: number | null;
}
const str = (x: unknown) => (typeof x === 'string' ? x : '');

/** Create — or edit (initial) — a one-off or recurring campaign: a NEW AI design for every slot, with the chosen creative direction. */
export function CampaignForm({ accounts, products, categories = [], initial }: { accounts: Opt[]; products: Opt[]; categories?: Opt[]; initial?: CampaignInitial }) {
  const router = useRouter();
  const d0 = (initial?.direction ?? {}) as Record<string, unknown>;
  const startLocal = initial ? formatInTimeZone(new Date(initial.startAt), TZ, "yyyy-MM-dd'T'HH:mm") : nowLocal();
  const [v, setV] = useState({
    name: initial?.name ?? '', accountIds: initial?.accountIds ?? ([] as string[]), productId: initial?.productId ?? '', categoryId: str(d0.categoryId),
    format: initial ? (initial.format ?? (d0.autoFormat ? 'AUTO' : '')) : 'AUTO', language: initial?.language ?? '', ideaMode: (str(d0.idea) ? 'custom' : 'auto') as 'auto' | 'custom',
    contentType: str(d0.contentType), market: str(d0.market), segment: str(d0.segment), occasion: str(d0.occasion), idea: str(d0.idea),
    scheduleType: (initial?.scheduleType ?? 'RECURRING') as 'ONCE' | 'RECURRING', everyHours: initial?.everyHours ?? 24, daysOfWeek: initial?.daysOfWeek ?? ([] as number[]), timeMode: (initial?.timeMode ?? 'BEST') as 'BEST' | 'FIXED',
    start: startLocal, end: initial?.endAt ? formatInTimeZone(new Date(initial.endAt), TZ, 'yyyy-MM-dd') : '', maxRuns: initial?.maxRuns ? String(initial.maxRuns) : '',
  });
  const set = <K extends keyof typeof v>(k: K) => (val: (typeof v)[K]) => setV((x) => ({ ...x, [k]: val }));
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [design, setDesign] = useState<DesignValues>(initial ? {
    ...EMPTY_DESIGN, renderMode: str(d0.renderMode) || 'auto', designStyle: str(d0.designStyle), customPrompt: str(d0.customPrompt), layout: str(d0.layout), designType: str(d0.designType),
    channels: Array.isArray(d0.channels) ? (d0.channels as string[]) : [], reelStyle: str(d0.reelStyle) || 'standard', reelDuration: d0.reelDuration ? String(d0.reelDuration) : '',
    audio: str(d0.audio), audioQuery: str(d0.audioQuery), videoEngine: str(d0.videoEngine),
  } : { ...EMPTY_DESIGN, renderMode: 'auto', designStyle: 'auto' });
  const fmt = v.format === 'AUTO' ? '' : v.format;

  const startAt = useMemo(() => { try { return fromZonedTime(v.start.length === 10 ? `${v.start}T00:00` : v.start, TZ); } catch { return null; } }, [v.start]);
  const endAt = useMemo(() => { try { return v.end ? fromZonedTime(`${v.end}T23:59`, TZ) : null; } catch { return null; } }, [v.end]);
  const preview = useMemo(() => (startAt && !isNaN(startAt.getTime()) ? previewSlots({
    scheduleType: v.scheduleType, everyHours: v.everyHours, daysOfWeek: v.daysOfWeek, timeMode: v.timeMode,
    startAt, endAt, maxRuns: v.maxRuns ? Number(v.maxRuns) : null, runs: 0,
  }, new Date(), 6) : []), [v.scheduleType, v.everyHours, v.daysOfWeek, v.timeMode, startAt, endAt, v.maxRuns]);
  const perDay = v.scheduleType === 'RECURRING' ? (v.everyHours >= 24 ? 1 / (v.everyHours / 24) : v.timeMode === 'BEST' ? bestHoursFor(v.everyHours).length : 24 / v.everyHours) : 0;

  return (
    <form className="space-y-6" onSubmit={async (e) => {
      e.preventDefault(); setMsg(null); setBusy(true);
      const direction: Record<string, unknown> = {};
      for (const k of ['contentType', 'market', 'segment', 'occasion'] as const) if (v[k].trim()) direction[k] = v[k].trim();
      if (v.ideaMode === 'custom' && v.idea.trim()) direction.idea = v.idea.trim();
      if (v.format === 'AUTO') direction.autoFormat = true;
      if (v.categoryId && !v.productId) direction.categoryId = v.categoryId;
      Object.assign(direction, designDirection(design, fmt));
      try {
        await apiCall(initial ? `/api/campaigns/${initial.id}` : '/api/campaigns', { method: initial ? 'PUT' : 'POST', body: {
          name: v.name, accountIds: v.accountIds, productId: v.productId || null, format: fmt || null, language: v.language || null,
          direction: Object.keys(direction).length ? direction : undefined,
          scheduleType: v.scheduleType, everyHours: v.everyHours, daysOfWeek: v.daysOfWeek, timeMode: v.scheduleType === 'ONCE' ? 'FIXED' : v.timeMode,
          startAt: startAt?.toISOString(), endAt: endAt?.toISOString() ?? null, maxRuns: v.maxRuns ? Number(v.maxRuns) : null,
        } });
        if (initial) { setMsg({ ok: true, t: 'تم حفظ التعديلات ✓' }); router.push('/campaigns'); router.refresh(); }
        else { setMsg({ ok: true, t: 'تم إنشاء الحملة ✓' }); router.refresh(); }
      } catch (x) { setMsg({ ok: false, t: (x as Error).message }); }
      setBusy(false);
    }}>
      {/* 1 — what */}
      <fieldset className="grid gap-4 md:grid-cols-4">
        <legend className="mb-2 text-sm font-extrabold text-navy-800">١. ماذا ننشر؟</legend>
        <div className="md:col-span-2"><label className="label">اسم الحملة</label><input className="input" required value={v.name} onChange={(e) => set('name')(e.target.value)} placeholder="مثال: أكواب العيد الوطني" /></div>
        <Sel label="فئة المنتج" value={v.categoryId} onChange={(x) => setV((s) => ({ ...s, categoryId: x, productId: '' }))}><option value="">اختيار تلقائي — كل الفئات</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Sel>
        <Sel label="المنتج" value={v.productId} onChange={set('productId')}><option value="">{v.categoryId ? 'اختيار تلقائي من هذه الفئة' : 'اختيار تلقائي لكل إعلان'}</option>{products.filter((p) => !v.categoryId || p.categoryId === v.categoryId).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Sel>
        <Sel label="الصيغة" value={v.format} onChange={set('format')}><option value="AUTO">تلقائي — تنويع ذكي (Reel · كاروسيل · منشور · ستوري)</option><option value="">حسب إعداد الحساب</option><option value="IMAGE_STORY">صورة عمودية</option><option value="IMAGE_FEED">صورة منشور</option><option value="IMAGE_SQUARE">صورة مربعة</option><option value="REEL_VIDEO">فيديو Reel</option><option value="IMAGE_CAROUSEL">كاروسيل (شرائح)</option></Sel>
        <Sel label="لغة المحتوى" value={v.language} onChange={set('language')}><option value="">حسب الحساب</option>{LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.ar}</option>)}</Sel>
        <Sel label="نوع المحتوى" value={v.contentType} onChange={set('contentType')}><option value="">تلقائي (يتنوع)</option>{CONTENT_TYPES.map((o) => <option key={o.value} value={o.value}>{o.ar}</option>)}</Sel>
        <Sel label="الجمهور والسوق" value={v.market} onChange={set('market')}><option value="">تلقائي</option>{MARKETS.map((o) => <option key={o.value} value={o.value}>{o.ar}</option>)}</Sel>
        <Sel label="الفئة المستهدفة" value={v.segment} onChange={set('segment')}><option value="">تلقائي</option>{SEGMENTS.map((o) => <option key={o.value} value={o.value}>{o.ar}</option>)}</Sel>
        <Sel label="نوع المناسبة" value={v.occasion} onChange={set('occasion')}><option value="">تلقائي</option>{OCCASIONS.map((o) => <option key={o.value} value={o.value}>{o.ar}</option>)}</Sel>
        <Sel label="الفكرة العامة" value={v.ideaMode} onChange={(x) => set('ideaMode')(x as 'auto' | 'custom')}><option value="auto">تلقائي — فكرة جديدة مختلفة في كل مرة</option><option value="custom">أكتب فكرة محددة</option></Sel>
        {v.ideaMode === 'custom' && <div className="md:col-span-3"><label className="label">فكرتك</label><input className="input" maxLength={500} value={v.idea} onChange={(e) => set('idea')(e.target.value)} placeholder="مثال: أكواب بمناسبة اليوم الوطني للشركات — يبتكر الذكاء الاصطناعي زاوية مختلفة حولها في كل مرة" /></div>}
      </fieldset>

      <DesignFields v={design} set={(patch) => setDesign((x) => ({ ...x, ...patch }))} format={fmt} />

      {/* 2 — where */}
      <fieldset>
        <legend className="mb-2 text-sm font-extrabold text-navy-800">٢. على أي حسابات؟ <span className="font-normal text-slate-500">(تصميم مستقل لكل حساب)</span></legend>
        <div className="mb-2 flex gap-3 text-xs"><button type="button" className="underline" onClick={() => set('accountIds')(accounts.map((a) => a.id))}>تحديد الكل</button><button type="button" className="underline" onClick={() => set('accountIds')([])}>إلغاء الكل</button></div>
        <div className="grid max-h-52 grid-cols-2 gap-1 overflow-y-auto rounded-lg border p-2 md:grid-cols-3">
          {accounts.map((a) => (
            <label key={a.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.accountIds.includes(a.id)} onChange={(e) => set('accountIds')(e.target.checked ? [...v.accountIds, a.id] : v.accountIds.filter((x) => x !== a.id))} />{a.label}</label>
          ))}
        </div>
      </fieldset>

      {/* 3 — when */}
      <fieldset className="space-y-4">
        <legend className="mb-2 text-sm font-extrabold text-navy-800">٣. متى؟ <span className="font-normal text-slate-500">(بتوقيت البحرين)</span></legend>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="radio" checked={v.scheduleType === 'ONCE'} onChange={() => set('scheduleType')('ONCE')} /> مرة واحدة في تاريخ ووقت محدد</label>
          <label className="flex items-center gap-2"><input type="radio" checked={v.scheduleType === 'RECURRING'} onChange={() => set('scheduleType')('RECURRING')} /> تكرار بتصميم جديد في كل مرة</label>
        </div>

        {v.scheduleType === 'RECURRING' && (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <Sel label="التكرار" value={String(v.everyHours)} onChange={(x) => set('everyHours')(Number(x))}>{INTERVALS.map((h) => <option key={h} value={h}>{intervalLabel(h)}</option>)}</Sel>
              <div className="md:col-span-2">
                <label className="label">وقت النشر</label>
                <div className="flex flex-wrap gap-4 pt-2 text-sm">
                  <label className="flex items-center gap-2"><input type="radio" checked={v.timeMode === 'BEST'} onChange={() => set('timeMode')('BEST')} /> أفضل وقت للنشر تلقائيًا</label>
                  <label className="flex items-center gap-2"><input type="radio" checked={v.timeMode === 'FIXED'} onChange={() => set('timeMode')('FIXED')} /> أحدد وقت البداية بنفسي</label>
                </div>
                {v.timeMode === 'BEST' && <p className="mt-1 text-xs text-slate-500">أفضل الساعات: {bestHoursFor(v.everyHours).map((h) => `${h}:00`).join('، ')} (حسب بيانات Metricool الفعلية لجمهورك على إنستغرام).</p>}
              </div>
            </div>
            <div>
              <label className="label">الأيام <span className="font-normal text-slate-500">(بدون اختيار = كل الأيام)</span></label>
              <div className="flex flex-wrap gap-2">
                {DAYS.map((d, i) => (
                  <button type="button" key={d} onClick={() => set('daysOfWeek')(v.daysOfWeek.includes(i) ? v.daysOfWeek.filter((x) => x !== i) : [...v.daysOfWeek, i].sort())}
                    className={`rounded-full border px-3 py-1 text-sm ${v.daysOfWeek.includes(i) ? 'border-navy-800 bg-navy-800 text-white' : 'border-slate-300 bg-white'}`}>{d}</button>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className="label">{v.scheduleType === 'ONCE' ? 'تاريخ ووقت النشر' : v.timeMode === 'FIXED' ? 'أول موعد (تاريخ ووقت)' : 'تاريخ البداية'}</label>
            {v.scheduleType === 'RECURRING' && v.timeMode === 'BEST'
              ? <input type="date" className="input ltr" value={v.start.slice(0, 10)} onChange={(e) => set('start')(e.target.value)} />
              : <input type="datetime-local" className="input ltr" value={v.start} onChange={(e) => set('start')(e.target.value)} />}
          </div>
          {v.scheduleType === 'RECURRING' && <div><label className="label">تاريخ النهاية (اختياري)</label><input type="date" className="input ltr" value={v.end} onChange={(e) => set('end')(e.target.value)} /></div>}
          {v.scheduleType === 'RECURRING' && <div><label className="label">أقصى عدد مرات (اختياري)</label><input type="number" min={1} className="input" value={v.maxRuns} onChange={(e) => set('maxRuns')(e.target.value)} /></div>}
        </div>

        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          <div className="mb-1 font-bold">المواعيد القادمة:</div>
          {preview.length ? <ul className="flex flex-wrap gap-2">{preview.map((d) => <li key={d.toISOString()} className="rounded bg-white px-2 py-1 text-xs shadow-sm ltr">{formatInTimeZone(d, TZ, 'EEE yyyy-MM-dd HH:mm')}</li>)}</ul> : <span className="text-red-700">لا توجد مواعيد مستقبلية بهذه الإعدادات.</span>}
          {v.scheduleType === 'RECURRING' && v.accountIds.length > 0 && perDay > 0 && (
            <p className="mt-2 text-xs text-slate-600">≈ {Math.round(perDay * v.accountIds.length * 10) / 10} تصميم جديد يوميًا ({v.accountIds.length} حساب). تذكّر حد الإنفاق والحد اليومي في إعدادات الذكاء الاصطناعي.</p>
          )}
        </div>
      </fieldset>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        كل موعد يولّد <b>تصميمًا جديدًا مختلفًا</b> (صورة بالذكاء الاصطناعي + الشعار الأصلي + أرقام التواصل + محتوى كامل) ويحفظه في المكتبة.
        في الوضع اليدوي/المساعد يذهب إلى <b>طابور الموافقات</b> ويُجدول تلقائيًا في موعده بعد اعتمادك؛ في الوضع الذاتي يُنشر للحسابات المفوّضة فقط.
      </div>

      <div className="flex items-center gap-3">
        <Button variant="gold" size="lg" disabled={busy || !v.accountIds.length || !preview.length}>{busy ? 'جارٍ الحفظ…' : initial ? 'حفظ التعديلات' : 'إنشاء الحملة'}</Button>
        {msg && <span className={msg.ok ? 'text-sm text-emerald-700' : 'rounded bg-red-50 p-2 text-sm text-red-700'}>{msg.t}</span>}
      </div>
    </form>
  );
}

