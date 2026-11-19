import type { Analysis, Brief } from './brief';
import type { Concept } from './concepts';

/**
 * DESIGN IDEAS for the AI picture of a print job. Two sources:
 *  - suggestions: 5 ideas fitted to the activity, the product, the audience and the chosen direction. They come from
 *    the AI when a key is set (one small text call), otherwise from ready templates per product family (free).
 *  - the owner's own idea («فكرتك للتصميم»): free text that becomes the core of the picture prompt (see artPlan).
 * Ideas describe a SCENE only. The system lays out the text, logo and contact data itself, so an idea never asks the
 * image model to write anything.
 */
export interface PrintIdea { title: string; idea: string; why: string }

const FAMILY_SCENES: Record<string, (act: string) => PrintIdea[]> = {
  card: (act) => [
    { title: 'تفصيلة مكبّرة', idea: `لقطة ماكرو لعنصر واحد من عالم ${act} على خلفية هادئة، وإضاءة جانبية ناعمة تُبرز الملمس`, why: 'المساحة صغيرة: عنصر واحد واضح يُقرأ من أول نظرة' },
    { title: 'نقش هندسي فاخر', idea: `نقش هندسي رفيع مستوحى من ${act}، بخطوط دقيقة متكررة وزاوية فارغة واسعة للنص`, why: 'يبدو فاخرًا ويترك مكانًا للاسم والأرقام' },
    { title: 'ملمس الخامة', idea: `خلفية ملمس طبيعي (ورق قطني أو رخام أو قماش) بلون الهوية، مع ظل خفيف لعنصر من ${act} في الطرف`, why: 'يناسب التشطيبات (سوفت تتش أو رقائق ذهبية)' },
    { title: 'لحظة من النشاط', idea: `لحظة حقيقية من ${act} بعمق ميدان ضحل، والموضوع في الثلث الأيمن، والباقي ضبابي ناعم`, why: 'يعرّف بالنشاط بلا كلام' },
    { title: 'خط واحد مستمر', idea: `رسم بخط واحد متصل يشكّل رمزًا من ${act}، ذهبي على خلفية داكنة`, why: 'بسيط ومميز ويُطبع بوضوح حتى بحجم صغير' },
  ],
  large_format: (act) => [
    { title: 'المشهد البطل', idea: `مشهد واسع لـ${act} بموضوع رئيسي كبير في الوسط وسماء أو خلفية بسيطة متصلة عند الأطراف`, why: 'يُرى من بعيد، والأطراف قابلة للتمديد' },
    { title: 'قبل وبعد', idea: `نصفان متجاوران: يسار قبل الخدمة ويمين بعدها في ${act}، والفاصل واضح`, why: 'الفائدة تُفهم في ثانيتين' },
    { title: 'المنتج يخرج من الإطار', idea: `منتج من ${act} ضخم بمنظور منخفض كأنه يخرج نحو المشاهد، وتباين قوي`, why: 'يوقف المارّة من مسافة' },
    { title: 'لون واحد جريء', idea: `خلفية بلون الهوية الأساسي مع عنصر واحد من ${act} بإضاءة درامية`, why: 'وضوح أعلى من الصور المزدحمة' },
    { title: 'روح البحرين', idea: `${act} في مكان بحريني معروف (الواجهة البحرية أو باب البحرين أو النخيل) في ضوء الغروب`, why: 'قريب من الجمهور المحلي' },
  ],
  folded: (act) => [
    { title: 'رحلة على الطيّات', idea: `مشهد بانورامي لـ${act} يمتد عبر الوجوه كقصة من اليمين لليسار`, why: 'كل طيّة تكشف جزءًا من الحكاية' },
    { title: 'غلاف بلحظة واحدة', idea: `لقطة غلاف قوية لعنصر من ${act} بخلفية نظيفة`, why: 'الغلاف يقرر هل تُفتح المطوية' },
    { title: 'أدوات النشاط', idea: `أدوات ${act} مرتبة من الأعلى (فلات لاي) على سطح بلون الهوية`, why: 'مرتب ويترك مساحات للنص' },
    { title: 'يد تقدّم الخدمة', idea: `يد تقدّم خدمة أو منتجًا من ${act} بلقطة قريبة ودافئة`, why: 'لمسة إنسانية بلا وجوه' },
    { title: 'خريطة رمزية', idea: `رسم مسطح لمسار أو خريطة رمزية لخطوات ${act}`, why: 'يناسب شرح الخطوات في الداخل' },
  ],
};
const GENERIC = (act: string): PrintIdea[] => [
  { title: 'عنصر واحد قوي', idea: `عنصر واحد يمثّل ${act} بإضاءة استوديو ناعمة على خلفية بلون الهوية`, why: 'واضح ويُطبع بدقة' },
  { title: 'ملمس فاخر', idea: `خلفية ملمس فاخر (رخام أو قماش أو ورق) مع لمسة ذهبية رفيعة`, why: 'يرفع قيمة المطبوع' },
  { title: 'نقش مستوحى من النشاط', idea: `نقش متكرر ناعم من رموز ${act}`, why: 'هوية متناسقة على كل المطبوعات' },
  { title: 'لحظة حقيقية', idea: `لحظة حقيقية من ${act} بعمق ميدان ضحل`, why: 'يبني الثقة' },
  { title: 'روح بحرينية', idea: `${act} بلمسة بحرينية: نخيل أو مشربية أو بحر، بألوان الهوية`, why: 'قريب من الجمهور المحلي' },
];

/** free suggestions from templates (dry-run / no key) */
export function templateIdeas(a: Analysis, b: Brief): PrintIdea[] {
  const act = (b.activity || a.identity.ar || 'النشاط').trim();
  const fam = a.product.family === 'sheet' ? 'folded' : a.product.family;
  return (FAMILY_SCENES[fam] ?? GENERIC)(act);
}

export const IDEAS_SYSTEM = [
  'You are a senior art director at a print shop in Bahrain. Propose design ideas for the AI PICTURE of one printed product.',
  'Each idea describes ONE visual scene: subject, composition, light, material and mood. The system lays out all text, the logo and contact details itself, so never ask for text, letters, names, numbers or logos inside the picture.',
  'Fit the idea to the product format (a business card is small: one clear subject and calm space; a roll-up is seen from metres away: one big subject and strong contrast; folded leaflets can carry a panorama across panels).',
  'Be specific and distinctive, not generic stock imagery. Culturally appropriate for Bahrain; modest clothing for any people.',
  'Write in Arabic (Gulf-friendly), short. Return JSON: {"ideas":[{"title":"2-4 words","idea":"one sentence, max 30 words","why":"max 12 words: why it fits this audience/product"}]} with exactly 5 ideas.',
].join('\n');

export function ideasUserPrompt(a: Analysis, b: Brief, c: Concept) {
  return JSON.stringify({
    product: `${a.product.ar} (${a.product.en})`, size_mm: `${a.trim.w}x${a.trim.h}`, family: a.product.family,
    activity: b.activity || a.identity.ar, business_type: a.identity.en, audience: b.audience || null, request: b.request?.slice(0, 600) || null,
    direction: `${c.name}: ${c.idea}`, palette: c.palette, current_idea: b.artIdea || null,
  });
}

/** validates the model's answer (5 short ideas, no request for text inside the picture) */
export function parseIdeas(raw: unknown): PrintIdea[] {
  const list = (raw as { ideas?: unknown })?.ideas;
  if (!Array.isArray(list)) return [];
  const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  return list.map((x) => ({ title: clean((x as PrintIdea).title, 40), idea: clean((x as PrintIdea).idea, 260), why: clean((x as PrintIdea).why, 120) }))
    .filter((x) => x.title && x.idea.length >= 12)
    .slice(0, 5);
}
