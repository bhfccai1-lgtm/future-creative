'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Ban, ChevronDown, Eye, ImageIcon, PenLine, Send, Sparkles, Trophy, Type, Wand2 } from 'lucide-react';
import { ReferenceUpload } from './reference-upload';
import { studioReadiness, type StudioValues } from '@/lib/creative/studio-readiness';

export type { StudioValues };

type Slot = 'general' | 'vertical' | 'feed' | 'square' | 'carousel';

const SLOTS: { slot: Slot; title: string; ratio: string; aspect: string; hint: string }[] = [
  { slot: 'general', title: 'عام', ratio: 'كل الصيغ', aspect: 'aspect-[4/5]', hint: 'الاحتياطي لأي صيغة بلا نموذج' },
  { slot: 'vertical', title: 'ستوري وريلز', ratio: '9:16', aspect: 'aspect-[9/16]', hint: 'عمودي 1080×1920' },
  { slot: 'feed', title: 'منشور', ratio: '4:5', aspect: 'aspect-[4/5]', hint: '1080×1350' },
  { slot: 'square', title: 'مربع', ratio: '1:1', aspect: 'aspect-square', hint: '1080×1080' },
  { slot: 'carousel', title: 'كاروسيل', ratio: '4:5', aspect: 'aspect-[4/5]', hint: 'الغلاف — وإلا يُستخدم نموذج المنشور' },
];

function Ring({ pct }: { pct: number }) {
  const r = 26, c = 2 * Math.PI * r;
  return (
    <svg width="68" height="68" viewBox="0 0 68 68" role="img" aria-label={`جاهزية الاستوديو ${pct}٪`} className="shrink-0">
      <circle cx="34" cy="34" r={r} fill="none" stroke="rgba(255,255,255,.15)" strokeWidth="6" />
      <circle cx="34" cy="34" r={r} fill="none" stroke="#e0c063" strokeWidth="6" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} transform="rotate(-90 34 34)" style={{ transition: 'stroke-dashoffset .5s ease' }} />
      <text x="34" y="39" textAnchor="middle" fontSize="15" fontWeight="800" fill="#fff">{pct}٪</text>
    </svg>
  );
}

function Section({ icon, title, summary, children, open = false }: { icon: React.ReactNode; title: string; summary: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group rounded-xl border border-slate-200 bg-white shadow-sm open:border-gold-400/70">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="text-gold-600">{icon}</span>
        <b className="shrink-0 text-sm text-navy-900">{title}</b>
        <span dir="auto" className="mr-auto min-w-0 truncate text-[11px] text-slate-500">{summary}</span>
        <ChevronDown size={18} className="shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-3 border-t border-slate-100 px-4 py-3 text-sm">{children}</div>
    </details>
  );
}

const Check = ({ checked, onChange, children, disabled }: { checked: boolean; onChange: (b: boolean) => void; children: React.ReactNode; disabled?: boolean }) => (
  <label className={`flex items-start gap-2 rounded-lg p-2 text-sm hover:bg-slate-50 ${disabled ? 'opacity-50' : ''}`}><input type="checkbox" className="mt-1 accent-navy-800" disabled={disabled} checked={checked} onChange={(e) => onChange(e.target.checked)} /><span className="leading-6">{children}</span></label>
);

/** «استوديو الإبداع»: the owner's creative direction for every design — guidance, reference designs per format, image
 *  quality, the quality index, text review and publishing touches — with a live preview and a readiness gauge. */
export function CreativeStudio<T extends StudioValues>({ v, setV }: { v: T; setV: (n: T) => void }) {
  const [slot, setSlot] = useState<Slot>('vertical');
  const refOf = (s: Slot) => (s === 'general' ? { key: v.styleReferenceKey ?? null, brief: v.styleReferenceBrief ?? '' } : (v.styleRefsByFormat?.[s] ?? { key: null, brief: '' }));
  const cur = SLOTS.find((x) => x.slot === slot)!;
  const own = refOf(slot);
  const fallback = slot === 'carousel' && !own.key && refOf('feed').key ? { ...refOf('feed'), from: 'نموذج المنشور' } : !own.key && v.styleReferenceKey ? { ...refOf('general'), from: 'النموذج العام' } : null;
  const shown = own.key ? own : fallback;
  const ready = studioReadiness(v);
  const score = v.adScore ?? { enabled: true, threshold: 95, maxRedraws: 1 };
  const set = (p: Partial<StudioValues>) => setV({ ...v, ...p });

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-gold-400/60 bg-[#faf7f0] md:col-span-3" aria-labelledby="studio-title">
      {/* header: navy + gold, the Manama skyline drawn in thin gold lines */}
      <div className="relative overflow-hidden bg-gradient-to-l from-navy-900 via-navy-800 to-navy-700 px-4 py-5 text-white sm:px-5">
        <svg aria-hidden className="pointer-events-none absolute bottom-0 left-0 h-full w-2/3 opacity-25" viewBox="0 0 600 120" preserveAspectRatio="xMinYMax slice">
          <g fill="none" stroke="#e0c063" strokeWidth="1.5">
            <path d="M0 110 H600" />
            <path d="M40 110 V70 H60 V110 M70 110 V55 H85 V110 M95 110 V80 H120 V110 M135 110 V60 L150 45 L165 60 V110" />
            <path d="M200 110 L215 25 L230 110 M245 110 L260 25 L275 110 M212 60 H263 M210 80 H265" />
            <path d="M300 110 V65 H325 V110 M335 110 V40 H350 V110 M360 110 V75 H390 V110 M405 110 V58 H425 V110" />
            <path d="M470 108 Q505 112 540 108 L530 98 H480 Z M505 98 V50 L535 92" />
          </g>
        </svg>
        <div className="relative flex flex-wrap items-center gap-4">
          <div className="border-r-4 border-gold-500 pr-3">
            <h3 id="studio-title" className="text-xl font-extrabold tracking-tight">استوديو الإبداع</h3>
            <p className="mt-0.5 text-xs text-navy-100">إعلانات المطبعة في البحرين كما يصممها مخرج فني محترف: فكرة، تصوير، تنقيح، ومعيار جودة</p>
          </div>
          <div className="mr-auto flex items-center gap-3 rounded-xl bg-navy-950/60 p-2 ring-1 ring-white/10 backdrop-blur-sm">
            <Ring pct={ready.pct} />
            <div className="max-w-[15rem] text-xs leading-5">
              <b className="text-gold-300">جاهزية الاستوديو</b>
              {ready.missing.length ? <p className="text-navy-100">التالي: {ready.missing[0]}{ready.missing.length > 1 ? ` (+${ready.missing.length - 1})` : ''}</p> : <p className="text-navy-100">إعداد احترافي كامل ✓</p>}
            </div>
          </div>
        </div>
      </div>

      <div className="grid min-w-0 gap-4 p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          {/* creative direction */}
          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
            <label className="mb-1.5 flex items-center gap-2 text-sm font-bold text-navy-900" htmlFor="studio-guidance"><PenLine size={18} className="text-gold-600" />توجيهات التصميم <span className="text-[11px] font-normal text-slate-500">تُطبَّق على كل تصميم وفكرة</span></label>
            <textarea id="studio-guidance" rows={2} maxLength={600} className="input" value={v.ownerGuidance ?? ''} onChange={(e) => set({ ownerGuidance: e.target.value })} placeholder="مثال: أبرز ملمس الكانفس في ضوء الغروب، ألوان دافئة، بدون وجوه أشخاص" />
            <div className="mt-1 flex justify-between text-[11px] text-slate-500"><span>أسباب رفضك للتصاميم السابقة تصل للمصمم تلقائيًا.</span><span className="ltr">{(v.ownerGuidance ?? '').length}/600</span></div>
            <label className="mb-1.5 mt-3 flex items-center gap-2 text-sm font-bold text-navy-900" htmlFor="studio-banned"><Ban size={18} className="text-gold-600" />العبارات المستبعدة <span className="text-[11px] font-normal text-slate-500">عبارة في كل سطر</span></label>
            <textarea id="studio-banned" rows={2} className="input" value={(v.bannedPhrases ?? []).join('\n')} onChange={(e) => set({ bannedPhrases: e.target.value.split('\n').map((x) => x.slice(0, 80)).slice(0, 30) })} placeholder="أدخل عبارات لا ترغب بظهورها في التصميم" />
          </div>

          {/* reference designs per format */}
          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
            <div className="mb-1 flex items-center gap-2 text-sm font-bold text-navy-900"><ImageIcon size={18} className="text-gold-600" />مراجع التصميم</div>
            <p className="mb-3 text-xs text-slate-500">اختر صيغة وارفع تصميمًا يعجبك لها: يأخذ الذكاء الاصطناعي أسلوبه (الألوان، الإضاءة، الزخارف) دون نسخ منتجه أو نصوصه.</p>
            <div role="radiogroup" aria-label="صيغة المرجع" className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {SLOTS.map((s) => {
                const r = refOf(s.slot), on = s.slot === slot;
                return (
                  <button key={s.slot} type="button" role="radio" aria-checked={on} onClick={() => setSlot(s.slot)}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border p-2 transition ${on ? 'border-gold-500 bg-gold-300/15 shadow-sm ring-1 ring-gold-400' : 'border-slate-200 hover:border-gold-400'}`}>
                    <span className="flex h-16 w-full items-center justify-center">
                      <span className={`${s.aspect} h-full overflow-hidden rounded-md bg-slate-100 shadow-[3px_3px_0_rgba(11,23,48,.12)]`}>
                        {r.key ? <img src={`/api/media/${r.key}`} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-slate-300"><ImageIcon size={16} /></span>}
                      </span>
                    </span>
                    <b className="text-xs text-navy-900">{s.title}</b>
                    <span className="flex items-center gap-1 text-[10px] text-slate-500"><span className={`h-1.5 w-1.5 rounded-full ${r.key ? 'bg-emerald-500' : 'bg-slate-300'}`} />{s.ratio}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-3">
              <ReferenceUpload key={slot} endpoint={slot === 'general' ? '/api/settings/ai/style-reference' : `/api/settings/ai/style-reference?slot=${slot}`} current={own.key} label={`نموذج ${cur.title}`} />
              <span className="text-[11px] text-slate-500">{cur.hint}</span>
            </div>
            <Check checked={v.useReferences ?? true} onChange={(b) => set({ useReferences: b })}>استخدام الصور المرجعية عند التوليد (صورة المنتج + التصميم المرجعي)</Check>
            <Check disabled={v.useReferences === false} checked={v.styleRefImage ?? true} onChange={(b) => set({ styleRefImage: b })}>إرسال صورة المرجع نفسها لنموذج الصور (أدق في مطابقة الأسلوب، تكلفة صورة صغيرة). أطفئه إن ظهرت عناصر منها في تصاميمك.</Check>
          </div>

          <Section icon={<Wand2 size={18} />} title="جودة الصور" summary={[(v.bestOf ?? 1) > 1 ? `${v.bestOf} صور ويُختار الأفضل` : 'صورة واحدة', (v.shotRecipes ?? true) && 'تصوير احترافي', (v.photoFinish ?? true) && 'تنقيح'].filter(Boolean).join(' · ')}>
            <Check checked={v.creativeConcepts ?? true} onChange={(b) => set({ creativeConcepts: b })}><b>فكرة بصرية مميزة لكل تصميم</b> — 10 أفكار تتناوب: طبيعة صامتة فاخرة، المنتج يطفو، لحظة مجمّدة، عالم مصغّر، تراث خليجي، لقطة سينمائية… (حسابات الشركات تأخذ الرسمية فقط)</Check>
            <Check checked={v.shotRecipes ?? true} onChange={(b) => set({ shotRecipes: b })}><b>📷 تصوير احترافي حسب المنتج</b> (مجاني) — المنتج يحدد الكاميرا والعدسة والإضاءة والسطح وواقعية الخامة، كمصوّر منتجات متخصص.</Check>
            <Check checked={v.photoFinish ?? true} onChange={(b) => set({ photoFinish: b })}><b>🎞 تنقيح استوديو بعد التوليد</b> (مجاني) — وضوح وتدرّج لوني يناسب المنتج وإطار ضوئي ناعم؛ يُلغى تلقائيًا إن أضرّ بالإضاءة.</Check>
            <div><label className="label" htmlFor="studio-bestof">المخرج الفني: عدد الصور لكل تصميم</label>
              <select id="studio-bestof" className="input max-w-xs" value={v.bestOf ?? 1} onChange={(e) => set({ bestOf: Number(e.target.value) })}>
                <option value={1}>صورة واحدة (الأوفر)</option><option value={2}>صورتان ويُختار الأفضل (موصى به)</option><option value={3}>3 صور ويُختار الأفضل</option>
              </select>
              <p className="mt-1 text-[11px] text-slate-500">كل صورة إضافية = تكلفة صورة.</p></div>
          </Section>

          <Section icon={<Trophy size={18} />} title="مؤشر الجودة الإبداعية من 100" summary={score.enabled ? `المعيار ${score.threshold} · إعادة رسم ${score.maxRedraws}` : 'متوقف'}>
            <Check checked={score.enabled} onChange={(b) => set({ adScore: { ...score, enabled: b } })}><b>🏆 مؤشر الجودة الإبداعية (دليل التصميم V10)</b> — يقيّم المخرج الفني: أصالة الفكرة 20، الجمال والإخراج 15، جذب الانتباه 15، التكوين 10، تناسق الألوان والخطوط 10، القيمة التسويقية 10، وضوح النص والمنتج 10؛ ويُقاس آليًا: الالتزام بالهوية 5 والملاءمة التقنية 5. 95+ مرشح للاعتماد · 90–94 ممتاز يحتاج مراجعة · 80–89 يحتاج تحسينًا · أقل من 80 إعادة تصميم. أي خطأ في الشعار أو النص أو الأرقام يمنع الاعتماد. تحت المعيار يُعاد الرسم، وإن لم يبلغه يُرسل لموافقتك. التكلفة ≈ $0.002 للفحص + صورة لكل إعادة. تقييم داخلي، لا ضمان للانتشار.</Check>
            {score.enabled && <div className="flex flex-wrap items-end gap-3 pr-6">
              <div><label className="label" htmlFor="studio-threshold">المعيار: <b className="text-navy-900">{score.threshold}</b></label>
                <input id="studio-threshold" type="range" min={50} max={100} step={1} className="w-48 accent-gold-500" value={score.threshold} onChange={(e) => set({ adScore: { ...score, threshold: Number(e.target.value) } })} /></div>
              <div><label className="label" htmlFor="studio-redraws">أقصى إعادة رسم</label><select id="studio-redraws" className="input w-44" value={score.maxRedraws} onChange={(e) => set({ adScore: { ...score, maxRedraws: Number(e.target.value) } })}><option value={0}>بدون (تقييم فقط)</option><option value={1}>مرة (موصى به)</option><option value={2}>مرتان</option><option value={3}>3 مرات</option></select></div>
            </div>}
          </Section>

          <Section icon={<Type size={18} />} title="مراجعة النصوص" summary={`تصحيح حتى ${v.aiFullTextRetries ?? 2} · ${(v.aiTextFallback ?? 'review') === 'review' ? 'الخطأ لموافقتك' : 'قالب ثابت'} · المزايا: ${{ ai: 'مدمجة', system: 'شريط', off: 'بدون' }[v.featuresRow ?? 'ai']}`}>
            <div><label className="label" htmlFor="studio-retries">✍️ تصحيح إملاء التصميم الكامل</label>
              <select id="studio-retries" className="input max-w-xs" value={v.aiFullTextRetries ?? 2} onChange={(e) => set({ aiFullTextRetries: Number(e.target.value) })}>
                <option value={0}>بدون إعادة (تحذير فقط)</option><option value={1}>إعادة رسم مرة عند الخطأ</option><option value={2}>حتى مرتين (موصى به)</option><option value={3}>حتى 3 مرات</option>
              </select><p className="mt-1 text-[11px] text-slate-500">يقرأ النظام النص المرسوم؛ إن وجد خطأ يعيد الرسم بتصحيح دقيق. كل إعادة = تكلفة صورة.</p></div>
            <div><label className="label" htmlFor="studio-fallback">إذا بقي خطأ بعد إعادة الرسم</label>
              <select id="studio-fallback" className="input max-w-md" value={v.aiTextFallback ?? 'review'} onChange={(e) => set({ aiTextFallback: e.target.value as 'review' | 'template' })}>
                <option value="review">احتفظ بالتصميم وأرسله لموافقتي (موصى به) — لا يُنشر تلقائيًا</option>
                <option value="template">استبدله بقالب ثابت بنص النظام</option>
              </select></div>
            <div><label className="label" htmlFor="studio-features">مزايا المطبعة في التصميم الكامل</label>
              <select id="studio-features" className="input max-w-md" value={v.featuresRow ?? 'ai'} onChange={(e) => set({ featuresRow: e.target.value as 'ai' | 'system' | 'off' })}>
                <option value="ai">مدمجة في التصميم حسب الفكرة (موصى به)</option>
                <option value="system">شريط مزايا تحت المنتج فوق زر الطلب (نص النظام)</option>
                <option value="off">بدون — مساحة أكبر للتصميم</option>
              </select><p className="mt-1 text-[11px] text-slate-500">«شريط تحت المنتج»: إطار يضم أول ميزتين بأيقونة ذهبية وفاصل، بإملاء مضمون — والوضع الهجين يستخدمه تلقائيًا.</p></div>
          </Section>

          <Section icon={<Send size={18} />} title="إعدادات النشر" summary={(v.captionMentions ?? []).length ? (v.captionMentions ?? []).join(' ') : 'بدون إشارات'}>
            <div><label className="label" htmlFor="studio-mentions">حسابات إنستغرام تُذكر في نص كل منشور</label>
              <input id="studio-mentions" className="input ltr max-w-md" dir="ltr" placeholder="@bhfcps @bhfcpss" value={(v.captionMentions ?? []).join(' ')}
                onChange={(e) => set({ captionMentions: e.target.value.split(/[\s,،]+/).filter(Boolean).map((h) => (h.startsWith('@') ? h : `@${h}`)).slice(0, 5) })} />
              <p className="mt-1 text-[11px] text-slate-500">تُضاف في آخر النص «تابعونا: …» ولا يُذكر الحساب في منشوره هو. حتى 5 حسابات. النشر الخارجي يبقى بطلبك أو بجدولتك فقط.</p></div>
          </Section>

          {/* actions */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gold-400/50 bg-white p-3">
            <button type="submit" className="inline-flex items-center gap-2 rounded-xl bg-navy-900 px-5 py-2.5 text-sm font-extrabold text-white shadow hover:bg-navy-800"><Sparkles size={16} className="text-gold-400" />حفظ الاستوديو</button>
            <button type="button" className="inline-flex items-center gap-2 rounded-xl border border-gold-500 bg-gold-300/20 px-4 py-2.5 text-sm font-bold text-navy-900 hover:bg-gold-300/40"
              onClick={() => set({ creativeConcepts: true, shotRecipes: true, photoFinish: true, bestOf: 2, adScore: { enabled: true, threshold: 95, maxRedraws: 1 }, aiFullTextRetries: Math.max(1, v.aiFullTextRetries ?? 2), qualityByFormat: { IMAGE_STORY: 'medium', IMAGE_FEED: 'high', IMAGE_SQUARE: 'high', IMAGE_CAROUSEL: 'high', REEL_VIDEO: 'high' } })}>
              ⭐ الجودة الاحترافية
            </button>
            <Link href="/create" className="mr-auto inline-flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-bold text-navy-800 hover:bg-slate-100"><Wand2 size={16} />توليد تصميم</Link>
            <p className="w-full text-[11px] text-slate-500">«الجودة الاحترافية» تضبط القيم فقط — اضغط «حفظ الاستوديو» لاعتمادها. التكلفة لكل تصميم تزيد تقريبًا 2–4 أضعاف؛ راجع الحد الشهري أدناه.</p>
          </div>
        </div>

        {/* live preview of the selected format's reference */}
        <aside className="mx-auto w-full max-w-[280px] lg:sticky lg:top-4 lg:max-w-none lg:self-start">
          <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-gold-500 px-2.5 py-1 text-xs font-bold text-navy-900"><Eye size={14} />معاينة المرجع</span>
              <span className="rounded-full bg-navy-900/80 px-2.5 py-0.5 text-xs font-bold text-white">{cur.ratio}</span>
            </div>
            <div className={`${cur.aspect} relative mx-auto max-h-[460px] overflow-hidden rounded-xl bg-gradient-to-b from-navy-800 to-navy-950`}>
              {shown?.key ? <img src={`/api/media/${shown.key}`} alt={`مرجع ${cur.title}`} className="h-full w-full object-cover" />
                : <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-navy-100"><ImageIcon size={28} className="text-gold-400" />لا يوجد مرجع لهذه الصيغة بعد<span className="text-[11px] text-navy-100/70">ارفع تصميمًا يعجبك ليأخذ المصمم أسلوبه</span></div>}
            </div>
            <p className="mt-2 text-center text-xs font-bold text-navy-900">{cur.title} <span className="font-normal text-slate-500">— {own.key ? 'مرجع خاص بالصيغة' : fallback ? `يُستخدم ${fallback.from}` : 'بدون مرجع'}</span></p>
            {shown?.brief ? <details className="mt-2 text-xs text-slate-600"><summary className="cursor-pointer font-bold text-navy-800">الأسلوب المقروء</summary><p className="ltr mt-1 max-h-40 overflow-auto leading-5" dir="ltr">{shown.brief}</p></details>
              : shown?.key ? <p className="mt-2 text-center text-[11px] text-slate-500">يُقرأ أسلوبه عند أول تصميم.</p> : null}
          </div>
        </aside>
      </div>
    </section>
  );
}
