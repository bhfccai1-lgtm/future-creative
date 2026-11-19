import { z } from 'zod';
import { FAMILIES, MATERIALS, PRODUCTS, available, ppiForDistance, productById, type Capabilities, type Product } from './catalog';
import { detectIndustry, type Identity } from './identity';

/** A design request: everything the system needs to understand the job (free text is parsed into these fields). */
export const BriefSchema = z.object({
  productId: z.string().max(40),
  request: z.string().max(2000).default(''),
  /** the owner's own idea for the AI picture («فكرتك للتصميم») — the core of the picture prompt */
  artIdea: z.string().max(600).optional(),
  business: z.string().max(120).default(''),
  activity: z.string().max(200).default(''),
  audience: z.string().max(200).default(''),
  lang: z.enum(['ar', 'en', 'bi']).default('ar'),
  sizeId: z.string().max(40).default(''),
  customMm: z.object({ w: z.number().min(10).max(10000), h: z.number().min(10).max(10000) }).optional(),
  orientation: z.enum(['portrait', 'landscape']).default('portrait'),
  sides: z.union([z.literal(1), z.literal(2)]).optional(),
  pages: z.number().int().min(1).max(1000).optional(),
  texts: z.object({
    headline: z.string().max(160).default(''), subline: z.string().max(240).default(''), body: z.string().max(1200).default(''),
    name: z.string().max(120).default(''), role: z.string().max(120).default(''), phone: z.string().max(60).default(''), email: z.string().max(120).default(''),
    website: z.string().max(120).default(''), address: z.string().max(200).default(''), cta: z.string().max(80).default(''), extra: z.array(z.string().max(200)).max(12).default([]),
  }).prefault({}),
  logoKey: z.string().max(300).optional(),
  dielineKey: z.string().max(300).optional(),
  /** the parsed supplier dieline (mm): cut / fold / perforation paths, glue zones, panels */
  dieline: z.object({ wMm: z.number(), hMm: z.number(), cut: z.array(z.string().max(20000)).max(50), fold: z.array(z.string().max(20000)).max(200), perf: z.array(z.string().max(20000)).max(100), glue: z.array(z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })).max(20), panels: z.array(z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })).max(60), warnings: z.array(z.string()).max(20) }).optional(),
  /** which panel carries the main design (index into dieline.panels, largest first) */
  frontPanel: z.number().int().min(0).max(59).default(0),
  material: z.string().max(40).optional(),
  finishes: z.array(z.string().max(40)).max(8).default([]),
  method: z.string().max(40).optional(),
  outputs: z.enum(['print', 'ad', 'both']).default('print'),
  conditions: z.object({ outdoor: z.boolean().default(false), waterproof: z.boolean().default(false), food: z.boolean().default(false), darkFabric: z.boolean().default(false) }).prefault({}),
  viewM: z.number().min(0.2).max(100).optional(),
  /** the printer's logo/numbers are placed in a CLIENT product only when the client agreed */
  shopBrandingConsent: z.boolean().default(false),
  /** order quantity (pieces / sets) — used for the quote; prices are always typed by the shop */
  quantity: z.number().int().min(1).max(10_000_000).optional(),
  /** elements that receive foil / spot UV / emboss */
  finishTarget: z.enum(['logo_headline', 'logo', 'headline', 'name']).default('logo_headline'),
});
export type Brief = z.infer<typeof BriefSchema>;

const PRODUCT_WORDS: [RegExp, string][] = [
  [/بطاق(ة|ات) (عمل|أعمال|اعمال)|بزنس كارد|business card|كرت شخصي|كروت/i, 'business_card'], [/رول ?أب|رول اب|roll[- ]?up/i, 'rollup'], [/إكس بنر|اكس بنر|x[- ]?banner/i, 'xbanner'],
  [/بنر|banner|لافتة/i, 'pvc_banner'], [/استيكر|ستيكر|ملصق|sticker/i, 'vinyl_sticker'], [/كوب|مق|mug/i, 'mug'], [/علب|علبة|box|كرتون/i, 'box'], [/كيس|أكياس|bag/i, 'paper_bag'],
  [/منيو|قائمة طعام|menu/i, 'menu'], [/فلاير|منشور|flyer|leaflet/i, 'flyer'], [/مطوي|brochure/i, 'brochure'], [/كتالوج|catalog/i, 'catalog'], [/بوستر|poster/i, 'poster'],
  [/تيشيرت|تي شيرت|t-?shirt|قميص/i, 'tshirt'], [/دعو(ة|ات) زفاف|wedding/i, 'wedding_invite'], [/شهاد/i, 'certificate'], [/ختم|stamp/i, 'rubber_stamp'], [/كتاب|book/i, 'book'], [/تقويم|calendar/i, 'calendar'],
  [/ظرف|أظرف|envelope/i, 'envelope'], [/ورق رسمي|letterhead/i, 'letterhead'], [/كانفس|canvas/i, 'canvas'], [/قبعة|كاب|cap/i, 'cap'],
];
export function guessProduct(text: string): string | null { return PRODUCT_WORDS.find(([re]) => re.test(text))?.[1] ?? null; }

/** Extracts contact data that the client actually wrote — never invents any. */
export function extractContacts(text: string) {
  const phone = text.match(/(?:\+?973[\s-]?)?\b[13-9]\d{3}[\s-]?\d{4}\b/)?.[0]?.replace(/\s+/g, ' ') ?? '';
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] ?? '';
  const website = text.match(/\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.(?:com|bh|net|org|co|store|shop)(?:\/\S*)?/i)?.[0] ?? '';
  const size = text.match(/(\d{2,4})\s*[x×*]\s*(\d{2,4})\s*(مم|mm|سم|cm)?/i);
  const mm = size ? { w: Number(size[1]) * (/سم|cm/i.test(size[3] ?? '') ? 10 : 1), h: Number(size[2]) * (/سم|cm/i.test(size[3] ?? '') ? 10 : 1) } : null;
  return { phone, email: website && email.endsWith(website) ? email : email, website: email.includes(website) ? '' : website, mm };
}

export interface Analysis {
  product: Product; familyAr: string; identity: Identity;
  trim: { w: number; h: number }; bleedMm: number; safeMm: number; targetPpi: number; sides: 1 | 2; pages: number;
  material: string | null; method: string | null;
  assumptions: string[]; warnings: string[]; blockers: string[];
  /** true only when nothing essential for production is missing (otherwise: preview only) */
  productionPossible: boolean;
}

/** REQUEST → PRODUCT ANALYSIS: product rules, the shop's real capabilities, the client's data, what is assumed and what blocks production. */
export function analyze(b: Brief, cap: Capabilities): Analysis {
  const product = productById(b.productId) ?? productById(guessProduct(b.request) ?? '') ?? PRODUCTS[0];
  const fam = FAMILIES[product.family], av = available(product, cap);
  const identity = detectIndustry([b.activity, b.business, b.request].join(' '));
  const assumptions: string[] = [], warnings: string[] = [], blockers: string[] = [];
  if (!av.enabled) blockers.push(`«${product.ar}» غير مفعّل في إمكانات المطبعة (الإعدادات)`);
  // size
  const parsed = extractContacts(b.request).mm;
  let size = product.sizes.find((s) => s.id === b.sizeId) ?? null;
  let trim = b.dieline ? { w: b.dieline.wMm, h: b.dieline.hMm } : b.customMm ?? (size ? { w: size.w, h: size.h } : parsed ?? null);
  if (b.dieline) { assumptions.push(`المقاس من Dieline المورد: ${b.dieline.wMm}×${b.dieline.hMm} مم (مفرود) · ${b.dieline.panels.length} وجه · ${b.dieline.fold.length} خط ثني`); for (const w of b.dieline.warnings) warnings.push(`Dieline: ${w}`); }
  if (!trim || !trim.w || !trim.h) {
    size = product.sizes.find((s) => s.w > 0) ?? null;
    if (product.family === 'packaging' || !size) { trim = { w: 200, h: 200 }; blockers.push(product.family === 'packaging' ? 'لا يوجد Dieline معتمد من المورد — معاينة فقط' : 'مقاس القالب غير معروف لهذا المنتج — أرفق قالب المورد'); }
    else { trim = { w: size.w, h: size.h }; assumptions.push(`المقاس: ${size.ar} (الافتراضي لهذا المنتج)`); }
  }
  if (!b.dieline && b.orientation === 'landscape' && trim.h > trim.w && product.family !== 'wrap') trim = { w: trim.h, h: trim.w };
  if (b.orientation === 'portrait' && trim.w > trim.h && ['sheet', 'multipage'].includes(product.family) && !b.customMm) trim = { w: trim.h, h: trim.w };
  // production requirements the system cannot invent
  for (const r of fam.requires ?? []) {
    if (r === 'dieline' && !b.dieline) { if (!blockers.some((x) => x.includes('Dieline'))) blockers.push('لا يوجد Dieline معتمد من المورد — معاينة فقط'); }
    if (r === 'product_template' && !size && !b.customMm) blockers.push('قالب منطقة الطباعة للمنتج غير معروف');
    if (r === 'product_template' && size) assumptions.push(`منطقة الطباعة: ${size.ar} — تأكد من مطابقتها لقالب المورد`);
    if (r === 'print_area') assumptions.push('منطقة الطباعة حسب المقاس المختار — تأكد من مقاس القطعة');
  }
  // material: suitability before beauty
  const mats = av.materials;
  let material = b.material && mats.includes(b.material) ? b.material : null;
  if (b.material && !mats.includes(b.material)) warnings.push(`الخامة «${MATERIALS[b.material]?.ar ?? b.material}» غير متاحة لهذا المنتج في المطبعة`);
  const suits = (m: string) => { const x = MATERIALS[m] ?? { ar: m }; return (!b.conditions.outdoor || x.outdoor) && (!b.conditions.waterproof || x.waterproof) && (!b.conditions.food || x.food); };
  if (material && !suits(material)) warnings.push(`«${MATERIALS[material]?.ar}» لا يناسب شروط الاستخدام (خارجي/ماء/غذاء)`);
  if (!material) { material = mats.find(suits) ?? mats[0] ?? null; if (material) assumptions.push(`الخامة: ${MATERIALS[material]?.ar ?? material} (مناسبة للاستخدام المذكور)`); }
  if (b.conditions.food) warnings.push('ملامسة الأغذية: الخامة والأحبار يجب أن تكون معتمدة من المورد — لا يُدّعى ذلك هنا');
  if (!mats.length) blockers.push('لا توجد خامة متاحة لهذا المنتج في المطبعة');
  const method = b.method && av.methods.includes(b.method) ? b.method : av.methods[0] ?? null;
  if (!method) blockers.push('لا توجد طريقة طباعة متاحة لهذا المنتج');
  for (const f of b.finishes) if (!av.finishes.includes(f)) warnings.push(`التشطيب «${f}» غير متاح لهذا المنتج في المطبعة — لن يُضاف`);
  // resolution by viewing distance
  const viewM = b.viewM ?? product.viewM;
  const targetPpi = viewM ? Math.min(fam.ppi === 100 ? 150 : fam.ppi, ppiForDistance(viewM)) : fam.ppi;
  if (viewM) assumptions.push(`مسافة المشاهدة ${viewM} م ← دقة مستهدفة ${targetPpi} PPI بالمقاس الفعلي`);
  // content we will not invent
  if (['card'].includes(product.family) && !b.texts.name && !b.business) warnings.push('لا يوجد اسم أو نشاط — ستظهر حقول فارغة لتعبئتها');
  if (!b.logoKey && product.family !== 'apparel') assumptions.push('لا يوجد شعار للعميل — يُترك مكانه أو يُكتب اسم النشاط نصًا');
  const sides = (b.sides ?? product.sides) as 1 | 2;
  let pages = product.family === 'multipage' ? b.pages ?? product.pages ?? 8 : sides;
  if (product.family === 'multipage' && pages % 4) { const p2 = Math.ceil(pages / 4) * 4; assumptions.push(`عدد الصفحات ${pages} ← ${p2} (مضاعفات 4 للتدبيس/الملازم)`); pages = p2; }
  if (cap.pdfx !== 'none') warnings.push(`المطبعة تطلب PDF/${cap.pdfx.toUpperCase()} — التصدير الحالي لا يدّعي التوافق (NOT_VERIFIED)`);
  return { product, familyAr: fam.ar, identity, trim, bleedMm: fam.bleedMm, safeMm: fam.safeMm, targetPpi, sides, pages, material, method, assumptions, warnings, blockers, productionPossible: blockers.length === 0 };
}
