'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiCall } from '@/lib/client/api';
import { Button } from './ui';
import { ReferenceUpload } from './reference-upload';

type Ai = { dryRun: boolean; textModel: string; imageModel: string; imageQuality: 'low' | 'medium' | 'high'; monthlyBudgetUsd: number; alertThresholdPct: number; maxDailyAds: number; maxRetries: number; creativeStyle: string; languages: string[]; useAiReview: boolean; imageQualityGate?: boolean; styleRefImage?: boolean; aiFullRequiresApproval: boolean; autoRenderMode?: string; autoDesignStyle?: string; creativeConcepts?: boolean; bestOf?: number; ownerGuidance?: string; bannedPhrases?: string[]; aiFullTextRetries?: number; aiTextFallback?: 'review' | 'template'; featuresRow?: 'ai' | 'system' | 'off'; captionMentions?: string[]; styleReferenceKey?: string | null; styleReferenceBrief?: string; styleRefsByFormat?: Partial<Record<'vertical' | 'feed' | 'square' | 'carousel', { key: string | null; brief: string }>>; useReferences?: boolean; pricing: Record<string, number>; qualityByFormat: Record<string, '' | 'low' | 'medium' | 'high'> ; adScore?: { enabled: boolean; threshold: number; maxRedraws: number } ; shotRecipes?: boolean; photoFinish?: boolean };
const FORMATS: [string, string][] = [['IMAGE_STORY', 'ستوري 1080×1920'], ['IMAGE_FEED', 'منشور 1080×1350'], ['IMAGE_SQUARE', 'مربع'], ['IMAGE_CAROUSEL', 'كاروسيل'], ['REEL_VIDEO', 'ريلز']];

export function AiSettingsForm({ ai, keyStatus }: { ai: Ai; keyStatus: { configured: boolean; last4: string | null } }) {
  const router = useRouter();
  const [v, setV] = useState(ai);
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const num = (k: keyof Ai) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: Number(e.target.value) });
  return (
    <form className="space-y-5" onSubmit={async (e) => {
      e.preventDefault(); setMsg(null);
      try { await apiCall('/api/settings/ai', { method: 'PUT', body: { ...v, apiKey: key || undefined } }); setKey(''); setMsg({ ok: true, t: 'تم الحفظ ✓' }); router.refresh(); }
      catch (x) { setMsg({ ok: false, t: (x as Error).message }); }
    }}>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2"><label className="label">مفتاح OpenAI API (يُخزّن مشفرًا على الخادم ولا يُعرض مجددًا)</label>
          <input type="password" autoComplete="off" className="input ltr" placeholder={keyStatus.configured ? `مضبوط ••••${keyStatus.last4}` : 'sk-…'} value={key} onChange={(e) => setKey(e.target.value)} /></div>
        <div className="flex items-end gap-2">
          <Button type="button" variant="outline" onClick={async () => { try { const r = await apiCall<{ ok: boolean; message: string }>('/api/settings/ai/verify', { method: 'POST' }); setMsg({ ok: r.ok, t: r.message }); } catch (x) { setMsg({ ok: false, t: (x as Error).message }); } }}>التحقق من المفتاح</Button>
          {keyStatus.configured && <Button type="button" variant="ghost" onClick={async () => { if (confirm('حذف المفتاح؟')) { await apiCall('/api/settings/ai', { method: 'PUT', body: { ...v, apiKey: '__delete__' } }); router.refresh(); } }}>حذف</Button>}
        </div>
        <label className="flex items-center gap-2 rounded-lg border p-3 text-sm md:col-span-3"><input type="checkbox" checked={v.dryRun} onChange={(e) => setV({ ...v, dryRun: e.target.checked })} /><b>وضع التجربة (Dry-run)</b> — بدون استدعاء OpenAI وبدون تكلفة. المخرجات معاينات غير قابلة للنشر.</label>
        <div className="grid gap-3 rounded-lg border p-3 md:col-span-3 md:grid-cols-2">
          <div className="md:col-span-2 text-sm font-extrabold text-navy-800">تصاميم النشر الآلي (الجدولة، الحملات، n8n)</div>
          <div><label className="label">طريقة التصميم</label><select className="input" value={v.autoRenderMode ?? 'auto'} onChange={(e) => setV({ ...v, autoRenderMode: e.target.value })}>
            <option value="auto">تلقائي (موصى به) — هجين: الذكاء الاصطناعي يصمم الإعلان كاملًا بلا نص، والنظام يكتب العنوان والشعار والأرقام بدقة 100٪ (ريلز Veo بطبقات)</option>
            <option value="hybrid">هجين دائمًا — تصميم ذكي حسب الفكرة + نص مضمون من النظام</option>
            <option value="ai_full">ملصق كامل بالذكاء الاصطناعي دائمًا (يرسم النص بنفسه، مع تصحيح إملائي)</option>
            <option value="layered">قالب بطبقات ونص مضمون 100% دائمًا</option></select></div>
          <div><label className="label">أسلوب التصميم</label><select className="input" value={v.autoDesignStyle ?? 'fc_signature'} onChange={(e) => setV({ ...v, autoDesignStyle: e.target.value })}>
            <option value="fc_signature">توقيع المطبعة الإعلاني (من نماذجك) — ألوان الخلفية تتغير حسب المناسبة والجمهور والمنتج</option>
            <option value="auto">تلقائي — يتنوع بين كل الأساليب</option></select></div>
        </div>
        <label className="flex items-start gap-2 rounded-lg border p-3 text-sm md:col-span-3"><input type="checkbox" className="mt-1" checked={v.imageQualityGate ?? true} onChange={(e) => setV({ ...v, imageQualityGate: e.target.checked })} /><span><b>فحص جودة الصور قبل التصميم</b> (موصى به) — يرفض الصورة التي رسم فيها الذكاء الاصطناعي نصًا أو حروفًا بالخطأ، أو الضبابية، أو سيئة الإضاءة، ويعيد توليدها مرة واحدة مع سبب الرفض. فحص بصري صغير لكل صورة (تكلفة زهيدة).</span></label>
        <label className="flex items-start gap-2 rounded-lg border p-3 text-sm md:col-span-3"><input type="checkbox" className="mt-1" checked={v.useAiReview} onChange={(e) => setV({ ...v, useAiReview: e.target.checked })} /><span><b>مراجعة لغوية بالذكاء الاصطناعي قبل رسم التصميم</b> — يصحّح الأخطاء الإملائية والنحوية المؤكدة فقط (اللهجة الخليجية ليست خطأ)، وما يحتمل الشك يظهر لك في تقرير الجودة. تكلفة طلب نصي صغير لكل تصميم.</span></label>
        <label className="flex items-start gap-2 rounded-lg border p-3 text-sm md:col-span-3"><input type="checkbox" className="mt-1" checked={v.aiFullRequiresApproval} onChange={(e) => setV({ ...v, aiFullRequiresApproval: e.target.checked })} /><span><b>طلب موافقتي على «التصميم الكامل بالذكاء الاصطناعي» قبل النشر</b> — النص في هذه التصاميم يرسمه النموذج وقد يحتوي أخطاء إملائية. عند إلغاء هذا الخيار تُنشر تلقائيًا في الوضع الذاتي (الشعار والأرقام وزر الطلب تبقى مضمونة لأن النظام يضيفها).</span></label>
        <div><label className="label">نموذج النص</label><input className="input ltr" value={v.textModel} onChange={(e) => setV({ ...v, textModel: e.target.value })} /></div>
        <div><label className="label">نموذج الصور</label><input className="input ltr" list="image-models" value={v.imageModel} onChange={(e) => setV({ ...v, imageModel: e.target.value })} />
          <datalist id="image-models"><option value="gpt-image-2" /><option value="gpt-image-1" /><option value="gpt-image-1-mini" /></datalist>
          <p className="mt-1 text-[11px] text-slate-500">gpt-image-2 للأحدث والأدق. إن لم يكن مفعّلًا لمفتاحك يُستخدم gpt-image-1 تلقائيًا وتصلك إشعار — التصاميم لا تتوقف. حدّث أسعار الصور بالأسفل حسب النموذج.</p></div>
        <div><label className="label">جودة الصور</label><select className="input" value={v.imageQuality} onChange={(e) => setV({ ...v, imageQuality: e.target.value as Ai['imageQuality'] })}><option value="low">منخفضة</option><option value="medium">متوسطة</option><option value="high">عالية</option></select></div>
        <fieldset className="rounded-lg border-2 border-gold-300 p-3 md:col-span-3">
          <legend className="px-1 text-sm font-bold text-navy-800">✨ استوديو الإبداع</legend>
          <div className="mb-3"><label className="label">🧭 توجيهك الدائم للمصمم (يُطبَّق على كل تصميم وفكرة)</label>
            <textarea rows={2} maxLength={600} className="input" value={v.ownerGuidance ?? ''} onChange={(e) => setV({ ...v, ownerGuidance: e.target.value })} placeholder="مثال: ألوان فاتحة ومبهجة، بدون وجوه أشخاص، أبرز اسم المنتج بخط كبير، لا خلفيات سوداء" />
            <p className="mt-1 text-xs text-slate-500">ومعه: أسباب رفضك للتصاميم السابقة تُرسل للمصمم تلقائيًا، والأفكار والأساليب التي ترفضها مرارًا تخرج من التناوب.</p></div>
          <div className="mb-3"><label className="label">🚫 عبارات ممنوعة (عبارة في كل سطر)</label>
            <textarea rows={2} className="input" value={(v.bannedPhrases ?? []).join('\n')} onChange={(e) => setV({ ...v, bannedPhrases: e.target.value.split('\n').map((x) => x.slice(0, 80)).slice(0, 30) })} placeholder="مثال: إذا ما صحتني القهوة" />
            <p className="mt-1 text-xs text-slate-500">لن تظهر في أي فكرة أو عنوان أو نص مرافق أو نص مرسوم — تُحذف من توجيهاتك وملاحظات الرفض قبل إرسالها للنموذج، وأي فكرة تحتويها تُعاد كتابتها.</p></div>
          <div className="mb-3 rounded-lg bg-gold-300/10 p-3"><label className="label">🖼️ التصميم المرجعي — مستوى الاحتراف المطلوب</label>
            <p className="mb-3 text-xs leading-6 text-slate-600">ارفع تصميمًا يعجبك لكل صيغة (مثل إعلان الكوب للستوري). يأخذ الذكاء الاصطناعي <b>أسلوبه</b> (الألوان، الإضاءة، الخطوط الذهبية، الزخارف، الأجواء): يقرؤه كوصف مكتوب، ويرسل الصورة نفسها لنموذج الصور كمرجع للأسلوب فقط مع تعليمات صارمة بألا ينسخ منتجها أو نصوصها أو توزيعها. يُطبَّق على كل التصاميم: «الملصق الكامل بالذكاء الاصطناعي» يأخذ أسلوبه كاملًا، والقوالب الثابتة (مثل الملصق الذهبي) تأخذ أجواء الصورة وإضاءتها وألوانها تحت تخطيط النظام، والمخرج الفني يفضّل المرشح الأقرب لأسلوبك. كل صيغة تستخدم نموذجها، وإن لم يكن لها نموذج تستخدم «العام». وارفع <b>صورة حقيقية لكل منتج</b> من «المنتجات والخدمات».</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {([['general', 'عام (لكل الصيغ)', 'الاحتياطي لأي صيغة بلا نموذج'], ['vertical', 'ستوري و Reel', 'عمودي 9:16'], ['feed', 'منشور', '4:5'], ['square', 'مربع', '1:1'], ['carousel', 'كاروسيل', 'الغلاف — وإلا يُستخدم نموذج المنشور']] as const).map(([slot, title, hint]) => {
                const ref = slot === 'general' ? { key: v.styleReferenceKey ?? null, brief: v.styleReferenceBrief ?? '' } : (v.styleRefsByFormat?.[slot] ?? { key: null, brief: '' });
                return (
                  <div key={slot} className="rounded-xl border bg-white p-3">
                    <div className="mb-2 flex items-baseline justify-between gap-2"><b className="text-sm text-navy-900">{title}</b><span className="text-[11px] text-slate-500">{hint}</span></div>
                    <ReferenceUpload endpoint={slot === 'general' ? '/api/settings/ai/style-reference' : `/api/settings/ai/style-reference?slot=${slot}`} current={ref.key} label={`نموذج ${title}`} />
                    {ref.key && ref.brief ? <details className="mt-2 text-xs text-slate-600"><summary className="cursor-pointer font-bold">الأسلوب المقروء</summary><p className="ltr mt-1 leading-5" dir="ltr">{ref.brief}</p></details> : ref.key ? <p className="mt-2 text-[11px] text-slate-500">يُقرأ أسلوبه عند أول تصميم.</p> : null}
                  </div>
                );
              })}
            </div>
            <label className="mt-2 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={v.useReferences ?? true} onChange={(e) => setV({ ...v, useReferences: e.target.checked })} /><span>استخدام الصور المرجعية عند التوليد (صورة المنتج + التصميم المرجعي)</span></label>
            <label className="mt-1 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" disabled={v.useReferences === false} checked={v.styleRefImage ?? true} onChange={(e) => setV({ ...v, styleRefImage: e.target.checked })} /><span>إرسال صورة التصميم المرجعي نفسها لنموذج الصور (أدق في مطابقة الأسلوب؛ تكلفة إدخال صورة صغيرة إضافية لكل تصميم). أطفئه إن ظهرت عناصر من الصورة المرجعية في تصاميمك.</span></label></div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={v.creativeConcepts ?? true} onChange={(e) => setV({ ...v, creativeConcepts: e.target.checked })} /><span><b>فكرة بصرية مميزة لكل تصميم</b> — 10 أفكار إبداعية تتناوب لكل حساب: طبيعة صامتة فاخرة، المنتج يطفو، لحظة حركة مجمّدة، عالم مصغّر، ورق مقصوص، لون جريء وأشكال هندسية، تراث خليجي فاخر، لقطة سينمائية، مجسّمات ناعمة، مفاجأة الحجم. حسابات الشركات تأخذ الأفكار الرسمية فقط.</span></label>
          <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={v.shotRecipes ?? true} onChange={(e) => setV({ ...v, shotRecipes: e.target.checked })} /><span><b>📷 تصوير احترافي حسب المنتج</b> (مجاني) — المنتج يحدد زاوية الكاميرا والعدسة وإعداد الإضاءة والسطح والإكسسوارات وواقعية الخامة، كما يصوّره مصوّر منتجات متخصص: الكوب بزاوية ثلاثة أرباع بعدسة 85 مم وإضاءة سوفت بوكس، الملصقات من الأعلى مع إضاءة جانبية تبرز حواف القص، البنر في مكانه الحقيقي بعدسة واسعة، الزجاج بإضاءة خلفية…</span></label>
          <label className="mt-2 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={v.photoFinish ?? true} onChange={(e) => setV({ ...v, photoFinish: e.target.checked })} /><span><b>🎞 تنقيح استوديو بعد التوليد</b> (مجاني، بلا ذكاء اصطناعي) — وضوح للتفاصيل الدقيقة، تدرّج لوني يناسب المنتج (دافئ للأكواب والأعراس، نقي للمطبوعات، غني للهدايا) وإطار ضوئي ناعم. يُقاس كل تعديل: إن زاد احتراق الإضاءة أو تغيّر السطوع تُحفظ الصورة الأصلية.</span></label>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div><label className="label">المخرج الفني: عدد الصور المولدة لكل تصميم</label>
              <select className="input" style={{ width: '16rem' }} value={v.bestOf ?? 1} onChange={(e) => setV({ ...v, bestOf: Number(e.target.value) })}>
                <option value={1}>صورة واحدة (الأوفر)</option><option value={2}>صورتان ويُختار الأفضل (موصى به)</option><option value={3}>3 صور ويُختار الأفضل</option>
              </select></div>
            <p className="text-xs text-slate-500">يقيّم الذكاء الاصطناعي كل صورة كمخرج فني (دقة شكل المنتج، الجمال، قوة التكوين، خلوها من الحروف) ويحتفظ بالأقوى. كل صورة إضافية = تكلفة صورة.</p>
          </div>
          <div className="mt-3 rounded-lg border border-gold-300 bg-gold-300/10 p-3">
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={v.adScore?.enabled ?? true} onChange={(e) => setV({ ...v, adScore: { threshold: 95, maxRedraws: 1, ...v.adScore, enabled: e.target.checked } })} /><span><b>🏆 مؤشر الخوارزمية الداخلي من 100</b> — المخرج الفني يقيّم الإعلان النهائي مع سبب لكل درجة: قوة الافتتاحية 20، وضوح المنتج والفائدة 20، ملاءمة الصيغة 15، قيمة المحتوى 15؛ وتُقاس آليًا: سهولة الإجراء 15 (زر الطلب، رقما الفرعين، دعوة في النص) وجودة التنفيذ 15 (النصوص، الشعار، الأرقام المعتمدة). أي رقم غير معتمد يمنع الاعتماد مهما كان المجموع. تحت المعيار يُعاد الرسم بملاحظة المخرج، وإن لم يبلغه يُرسل لموافقتك ولا يُنشر تلقائيًا. التكلفة: فحص بصري صغير (≈ $0.002) لكل نسخة + صورة لكل إعادة رسم. معيار جودة، وليس ضمانًا للانتشار.</span></label>
            {(v.adScore?.enabled ?? true) && <div className="mt-2 flex flex-wrap items-end gap-3 pr-6">
              <div><label className="label">المعيار (من 100)</label><input type="number" min={50} max={100} className="input" style={{ width: '7rem' }} value={v.adScore?.threshold ?? 95} onChange={(e) => setV({ ...v, adScore: { enabled: true, maxRedraws: 1, ...v.adScore, threshold: Number(e.target.value) } })} /></div>
              <div><label className="label">أقصى إعادة رسم لبلوغ المعيار</label><select className="input" style={{ width: '12rem' }} value={v.adScore?.maxRedraws ?? 1} onChange={(e) => setV({ ...v, adScore: { enabled: true, threshold: 95, ...v.adScore, maxRedraws: Number(e.target.value) } })}><option value={0}>بدون (تقييم فقط)</option><option value={1}>مرة واحدة (موصى به)</option><option value={2}>مرتان</option><option value={3}>3 مرات</option></select></div>
            </div>}
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div><label className="label">✍️ تصحيح إملاء التصميم الكامل بالذكاء الاصطناعي</label>
              <select className="input" style={{ width: '16rem' }} value={v.aiFullTextRetries ?? 2} onChange={(e) => setV({ ...v, aiFullTextRetries: Number(e.target.value) })}>
                <option value={0}>بدون إعادة (تحذير فقط)</option><option value={1}>إعادة رسم مرة عند الخطأ</option><option value={2}>حتى مرتين (موصى به)</option><option value={3}>حتى 3 مرات</option>
              </select></div>
            <p className="text-xs text-slate-500">يقرأ النظام النص الذي رسمه الذكاء الاصطناعي قبل إنهاء التصميم؛ إذا وجد كلمة خاطئة أو ناقصة يعيد الرسم بتصحيح دقيق. كل إعادة = تكلفة صورة.</p>
            <div><label className="label">إذا بقي خطأ إملائي بعد إعادة الرسم</label>
              <select className="input" style={{ width: '22rem' }} value={v.aiTextFallback ?? 'review'} onChange={(e) => setV({ ...v, aiTextFallback: e.target.value as 'review' | 'template' })}>
                <option value="review">احتفظ بتصميم الذكاء الاصطناعي وأرسله لموافقتي (موصى به)</option>
                <option value="template">استبدله بقالب ثابت بنص النظام</option>
              </select></div>
            <p className="text-xs text-slate-500">«موافقتي»: يبقى التنسيق مصممًا حسب الفكرة والمناسبة، وتظهر لك الكلمات الخاطئة — لا يُنشر تلقائيًا أبدًا. «قالب ثابت»: نص مضمون الإملاء لكن بتصميم قالب.</p>
            <div><label className="label">مزايا المطبعة (تصاميم مخصصة، جودة طباعة…) في التصميم الكامل</label>
              <select className="input" style={{ width: '22rem' }} value={v.featuresRow ?? 'ai'} onChange={(e) => setV({ ...v, featuresRow: e.target.value as 'ai' | 'system' | 'off' })}>
                <option value="ai">مدمجة في التصميم حسب الفكرة (موصى به)</option>
                <option value="system">شريط أيقونات ثابت فوق زر الطلب</option>
                <option value="off">بدون — مساحة أكبر للتصميم</option>
              </select></div>
            <p className="text-xs text-slate-500">«مدمجة»: يرسمها الذكاء الاصطناعي في مكان يناسب الفكرة (قائمة بعلامات ذهبية، شارات…) ويُدقق إملاؤها مع العنوان. الشريط الثابت كان يغطي أسفل التصميم.</p>
          </div>
          <div className="mt-3">
            <label className="label">حسابات إنستغرام تُذكر في نص كل منشور</label>
            <input className="input ltr" style={{ maxWidth: '30rem' }} dir="ltr" placeholder="@bhfcps @bhfcpss" value={(v.captionMentions ?? []).join(' ')}
              onChange={(e) => setV({ ...v, captionMentions: e.target.value.split(/[\s,،]+/).filter(Boolean).map((h) => (h.startsWith('@') ? h : `@${h}`)).slice(0, 5) })} />
            <p className="mt-1 text-xs text-slate-500">تُضاف في آخر النص: «تابعونا: @bhfcps @bhfcpss» — ولا يُذكر الحساب في منشوره هو. حتى 5 حسابات، افصل بينها بمسافة.</p>
          </div>
          <button type="button" className="mt-3 rounded-lg bg-navy-800 px-3 py-1.5 text-xs font-bold text-white" onClick={() => setV({ ...v, creativeConcepts: true, bestOf: 2, qualityByFormat: { IMAGE_STORY: 'medium', IMAGE_FEED: 'high', IMAGE_SQUARE: 'high', IMAGE_CAROUSEL: 'high', REEL_VIDEO: 'high' } })}>⭐ تطبيق «الجودة الاحترافية»: عالية للريلز والمنشورات والكاروسيل · متوسطة للستوري · صورتان ويُختار الأفضل</button>
          <p className="mt-1 text-xs text-slate-500">ثم اضغط «حفظ الإعدادات». راجع الحد الشهري للإنفاق أدناه — التكلفة لكل تصميم تزيد تقريبًا 2–4 أضعاف.</p>
        </fieldset>
        <fieldset className="rounded-lg border p-3 md:col-span-3">
          <legend className="px-1 text-sm font-bold text-navy-800">الجودة حسب الصيغة</legend>
          <p className="mb-2 text-xs text-slate-500">الذكاء الاصطناعي يرسم صورة المنتج فقط — الشعار والنصوص والأرقام يضيفها النظام بنفس الدقة في كل المستويات. «حسب الإعداد العام» = جودة الصور أعلاه.</p>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-5">
            {FORMATS.map(([f, label]) => {
              const q = (v.qualityByFormat?.[f] || v.imageQuality) as 'low' | 'medium' | 'high';
              const price = q === 'low' ? v.pricing.imageLow : q === 'high' ? v.pricing.imageHigh : v.pricing.imageMedium;
              return (
                <div key={f}><label className="label">{label}</label>
                  <select className="input" value={v.qualityByFormat?.[f] ?? ''} onChange={(e) => setV({ ...v, qualityByFormat: { ...v.qualityByFormat, [f]: e.target.value as Ai['qualityByFormat'][string] } })}>
                    <option value="">حسب الإعداد العام</option><option value="low">منخفضة</option><option value="medium">متوسطة</option><option value="high">عالية</option>
                  </select>
                  <p className="mt-1 text-xs text-slate-500 ltr">≈ ${(price + 0.002).toFixed(3)} / design</p></div>
              );
            })}
          </div>
          <button type="button" className="mt-2 text-xs font-bold text-gold-600 underline" onClick={() => setV({ ...v, qualityByFormat: { IMAGE_STORY: 'low', IMAGE_FEED: 'medium', IMAGE_SQUARE: 'medium', IMAGE_CAROUSEL: 'medium', REEL_VIDEO: 'medium' } })}>تطبيق الموصى به (ستوري منخفضة · الباقي متوسطة)</button>
        </fieldset>
        <div><label className="label">حد الإنفاق الشهري (USD)</label><input type="number" min={0} step="0.5" className="input" value={v.monthlyBudgetUsd} onChange={num('monthlyBudgetUsd')} /></div>
        <div><label className="label">تنبيه عند نسبة (%)</label><input type="number" min={1} max={100} className="input" value={v.alertThresholdPct} onChange={num('alertThresholdPct')} /></div>
        <div><label className="label">الحد الأقصى اليومي للإعلانات</label><input type="number" min={0} className="input" value={v.maxDailyAds} onChange={num('maxDailyAds')} /></div>
        <div><label className="label">أقصى إعادة محاولة لكل طلب</label><input type="number" min={0} max={5} className="input" value={v.maxRetries} onChange={num('maxRetries')} /></div>
        <div className="md:col-span-2"><label className="label">اللغات المفعّلة</label><div className="flex gap-4 pt-2 text-sm">{[['ar', 'العربية'], ['en', 'English'], ['ml', 'Malayalam'], ['hi', 'हिन्दी Hindi']].map(([k, l]) => <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={v.languages.includes(k)} onChange={(e) => setV({ ...v, languages: e.target.checked ? [...v.languages, k] : v.languages.filter((x) => x !== k) })} />{l}</label>)}</div></div>
        <div className="md:col-span-3"><label className="label">الأسلوب الإبداعي</label><textarea rows={3} className="input ltr" value={v.creativeStyle} onChange={(e) => setV({ ...v, creativeStyle: e.target.value })} /></div>
        <fieldset className="grid gap-2 rounded-lg border p-3 md:col-span-3 md:grid-cols-5">
          <legend className="px-1 text-xs font-bold text-slate-500">أسعار تقديرية للتتبع (USD) — حدّثها وفق تسعير OpenAI الحالي</legend>
          {Object.entries(v.pricing).map(([k, val]) => <div key={k}><label className="text-xs ltr">{k}</label><input type="number" step="0.001" min={0} className="input" value={val} onChange={(e) => setV({ ...v, pricing: { ...v.pricing, [k]: Number(e.target.value) } })} /></div>)}
        </fieldset>
      </div>
      <div className="flex items-center gap-3"><Button>حفظ الإعدادات</Button>{msg && <span className={msg.ok ? 'text-sm text-emerald-700' : 'rounded bg-red-50 p-2 text-sm text-red-700'}>{msg.t}</span>}</div>
    </form>
  );
}
