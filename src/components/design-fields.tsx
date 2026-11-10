'use client';
import { AUDIO_TYPES, CHANNELS, DESIGN_STYLES, DESIGN_TYPES, REEL_DURATIONS, REEL_STYLES, proSceneCount } from '@/lib/creative/options';

export interface DesignValues {
  designType: string; designStyle: string; channels: string[];
  reelStyle: string; reelDuration: string; audio: string; audioQuery: string;
}
export const EMPTY_DESIGN: DesignValues = { designType: '', designStyle: '', channels: [], reelStyle: 'standard', reelDuration: '', audio: 'none', audioQuery: '' };

/** Adds the design/channel/reel options of a DesignValues object to a direction payload. */
export function designDirection(v: DesignValues, format: string) {
  const d: Record<string, unknown> = {};
  if (v.designType) d.designType = v.designType;
  if (v.designStyle) d.designStyle = v.designStyle;
  if (v.channels.length) d.channels = v.channels;
  if (format === 'REEL_VIDEO' || format === '') {
    if (v.reelStyle) d.reelStyle = v.reelStyle;
    if (v.reelDuration) d.reelDuration = Number(v.reelDuration);
    if (v.audio) d.audio = v.audio;
    if (v.audio === 'instagram' && v.audioQuery.trim()) d.audioQuery = v.audioQuery.trim();
  }
  return d;
}

function Sel({ label, value, onChange, children, hint }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode; hint?: string }) {
  return <div><label className="label">{label}</label><select className="input" value={value} onChange={(e) => onChange(e.target.value)}>{children}</select>{hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}</div>;
}

/** Shared "design & publishing" fields for the create page and campaigns. */
export function DesignFields({ v, set, format }: { v: DesignValues; set: (patch: Partial<DesignValues>) => void; format: string }) {
  const isReel = format === 'REEL_VIDEO';
  const dur = Number(v.reelDuration || 12);
  return (
    <>
      <fieldset className="grid gap-4 md:grid-cols-3">
        <legend className="mb-2 text-sm font-extrabold text-navy-800">التصميم</legend>
        <Sel label="نوع التصميم" value={v.designType} onChange={(x) => set({ designType: x })}><option value="">اختيار تلقائي</option>{DESIGN_TYPES.map((o) => <option key={o.value} value={o.value}>{o.ar}</option>)}</Sel>
        <Sel label="أسلوب التصميم" value={v.designStyle} onChange={(x) => set({ designStyle: x })} hint="يغيّر ألوان القالب وأسلوب الصورة؛ الشعار يبقى كما هو"><option value="">هوية المطبعة (كحلي وذهبي)</option>{DESIGN_STYLES.map((o) => <option key={o.value} value={o.value}>{o.ar}</option>)}</Sel>
        <div>
          <label className="label">قنوات النشر</label>
          <div className="grid grid-cols-2 gap-1 rounded-lg border p-2 text-sm">
            {CHANNELS.map((c) => (
              <label key={c.value} className={`flex items-center gap-2 ${c.video && !isReel ? 'opacity-50' : ''}`}>
                <input type="checkbox" disabled={c.video && !isReel} checked={v.channels.includes(c.value)} onChange={(e) => set({ channels: e.target.checked ? [...v.channels, c.value] : v.channels.filter((x) => x !== c.value) })} />{c.ar}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">بدون اختيار = منصة الحساب نفسه. يجب أن تكون القناة مربوطة بنفس العلامة في Metricool.</p>
        </div>
      </fieldset>

      <fieldset className={`grid gap-4 md:grid-cols-4 ${isReel ? '' : 'opacity-60'}`}>
        <legend className="mb-2 text-sm font-extrabold text-navy-800">الريلز (الفيديو) {!isReel && <span className="font-normal text-slate-500">— اختر الصيغة «فيديو Reel» لتفعيلها</span>}</legend>
        <Sel label="نوع الريلز" value={v.reelStyle} onChange={(x) => set({ reelStyle: x })}>{REEL_STYLES.map((o) => <option key={o.value} value={o.value}>{o.ar}</option>)}</Sel>
        <Sel label="مدة الريلز" value={v.reelDuration} onChange={(x) => set({ reelDuration: x })}><option value="">حسب إعداد الحساب</option>{REEL_DURATIONS.map((d) => <option key={d} value={d}>{d} ثانية</option>)}</Sel>
        <Sel label="نوع الصوت" value={v.audio} onChange={(x) => set({ audio: x })}>{AUDIO_TYPES.map((o) => <option key={o.value} value={o.value}>{o.ar}</option>)}</Sel>
        {v.audio === 'instagram'
          ? <div><label className="label">اسم الأغنية أو الفنان</label><input className="input" maxLength={120} value={v.audioQuery} onChange={(e) => set({ audioQuery: e.target.value })} placeholder="مثال: اسم مقطع رائج" /><p className="mt-1 text-xs text-slate-500">لحسابات إنستغرام التجارية المربوطة بفيسبوك فقط.</p></div>
          : <div className="text-xs text-slate-500 md:pt-7">{v.reelStyle === 'pro' ? `الاحترافي: ${proSceneCount(dur)} مشاهد مولدة (${proSceneCount(dur)} صور ذكاء اصطناعي) بانتقالات سينمائية.` : 'العادي: مشهد واحد بحركة كاميرا ونصوص متحركة.'}</div>}
      </fieldset>
    </>
  );
}
