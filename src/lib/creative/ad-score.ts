import type { LayerManifest } from '../render/compose';

/**
 * CREATIVE QUALITY SCORE (Creative Design Playbook V10.0 §12) — 100 points, an INTERNAL editorial estimate (not a
 * platform score, no promise of reach). A design is used automatically only at ≥ the threshold (default 95).
 *  - JUDGED by the art director on the finished ad (vision), each with a reason pointing at something visible:
 *      originality 20 · aesthetics & art direction 15 · attention 15 · composition & hierarchy 10 ·
 *      colour & type harmony 10 · marketing value 10 · text & product clarity 10
 *  - MEASURED (the system guarantees or checks them — never guessed):
 *      brand 5     = the ORIGINAL logo layer is present
 *      technical 5 = every text layer fits with all its glyphs 3 + the order button and the approved phones 2
 *  - BLOCKERS (no approval whatever the total): a phone that is not an approved one, the original logo missing, text
 *    with missing glyphs (an incomplete word). Bands: 95–100 candidate · 90–94 excellent, final review · 80–89 improve
 *    · < 80 redesign.
 */
export const RUBRIC = [
  { key: 'originality', ar: 'أصالة الفكرة والابتكار', max: 20, judged: true },
  { key: 'aesthetics', ar: 'الجمال والإخراج الفني', max: 15, judged: true },
  { key: 'attention', ar: 'قوة جذب الانتباه', max: 15, judged: true },
  { key: 'composition', ar: 'التكوين والتسلسل البصري', max: 10, judged: true },
  { key: 'harmony', ar: 'تناسق الألوان والخطوط', max: 10, judged: true },
  { key: 'marketing', ar: 'القيمة التسويقية', max: 10, judged: true },
  { key: 'clarity', ar: 'وضوح النص والمنتج', max: 10, judged: true },
  { key: 'brand', ar: 'الالتزام بالهوية', max: 5, judged: false },
  { key: 'technical', ar: 'الملاءمة التقنية للمقاس', max: 5, judged: false },
] as const;
export const JUDGED_KEYS = RUBRIC.filter((r) => r.judged).map((r) => r.key);
/** the playbook's internal bands */
export function scoreBand(total: number): { key: 'candidate' | 'excellent' | 'improve' | 'redesign'; ar: string } {
  return total >= 95 ? { key: 'candidate', ar: 'مرشح للاعتماد النهائي' } : total >= 90 ? { key: 'excellent', ar: 'ممتاز — يحتاج مراجعة نهائية' }
    : total >= 80 ? { key: 'improve', ar: 'يحتاج تحسينًا' } : { key: 'redesign', ar: 'إعادة التصميم' };
}
export type RubricKey = (typeof RUBRIC)[number]['key'];
export interface AdScore {
  total: number; parts: Record<RubricKey, number>; reasons: Partial<Record<RubricKey, string>>;
  weakness: string; fix: string; passed: boolean; threshold: number;
  /** a wrong phone number / brand name: never approvable, whatever the total */
  blocked?: string;
}

const FORMAT_AR: Record<string, string> = { IMAGE_FEED: 'Instagram vertical post 4:5', IMAGE_SQUARE: 'square post 1:1', IMAGE_STORY: 'Instagram story 9:16 (seen for a few seconds)', REEL_VIDEO: 'Reel 9:16 (its first frame)', IMAGE_CAROUSEL: 'carousel cover 4:5' };

/** The vision instructions (only the judged criteria; JSON answer with a reason per criterion). */
export function scoreAdPrompt(ctx: { product: string; idea: string; platform: string }) {
  return [
    'You are the demanding creative director of a print shop in Bahrain judging a FINISHED social-media ad before publication.',
    `Product: ${ctx.product}. Idea: ${ctx.idea}. Format: ${FORMAT_AR[ctx.platform] ?? ctx.platform}.`,
    'Score strictly — 95+ only for work that could win an award; ordinary competent work is 60–80. Give each score a short reason pointing at something VISIBLE. JSON only:',
    '{"originality": 0-20 (an unexpected, ownable idea — not a stock template or just a colour/background change?),',
    ' "aesthetics": 0-15 (beauty and art direction: light, materials, finish, no AI artefacts?),',
    ' "attention": 0-15 (does the first look give THIS audience a reason to stop scrolling?),',
    ' "composition": 0-10 (balance, visual hierarchy, negative space, the eye path ends at the product and the call to action?),',
    ' "harmony": 0-10 (colours and type work together and fit the product and the brand?),',
    ' "marketing": 0-10 (a real reason to buy or save/share for this audience, no exaggerated claims?),',
    ' "clarity": 0-10 (product and message understood in 2 seconds, text readable on a phone?),',
    ' "reasons": {"originality": "...", "aesthetics": "...", "attention": "...", "composition": "...", "harmony": "...", "marketing": "...", "clarity": "..."},',
    ' "weakness": "<the single weakest element, concrete>", "fix": "<ONE concrete change for the image model that fixes it>"}',
  ].join('\n');
}

const clamp = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));

export interface MeasureCtx { approvedPhones?: string[]; caption?: string }
/** Combines the judged points with the measured ones (layers of the finished ad + the caption). */
export function combineScore(judged: Partial<Record<string, unknown>>, manifest: Pick<LayerManifest, 'layers'>, threshold: number, weakness = '', fix = '', ctx: MeasureCtx = {}, reasons: Partial<Record<string, string>> = {}): AdScore {
  const L = manifest.layers;
  const textLayers = L.filter((l) => l.text && l.text.trim());
  const okText = textLayers.filter((l) => l.fits !== false && !(l.missing?.length)).length;
  const phones = L.filter((l) => /^contact:.*:phone$/.test(l.id)).map((l) => (l.text ?? '').replace(/\D/g, ''));
  const approved = (ctx.approvedPhones ?? []).map((p) => p.replace(/\D/g, ''));
  const phonesExact = phones.length > 0 && (!approved.length || (phones.every((p) => approved.includes(p)) && approved.every((p) => phones.includes(p))));
  const parts = Object.fromEntries(RUBRIC.map((r) => [r.key, r.judged ? clamp(judged[r.key], r.max) : 0])) as Record<RubricKey, number>;
  const logo = L.some((l) => l.id === 'logo');
  const allText = textLayers.length > 0 && okText === textLayers.length;
  parts.brand = logo ? 5 : 0;
  parts.technical = (allText ? 3 : 0) + (L.some((l) => l.id === 'cta') && phones.length > 0 && phonesExact ? 2 : 0);
  const total = RUBRIC.reduce((a, r) => a + parts[r.key], 0);
  // the playbook's blockers: wrong contact details, the original logo missing, an incomplete word
  const glyphGaps = textLayers.filter((l) => l.missing?.length).map((l) => l.id);
  const blocked = approved.length && phones.length && !phonesExact ? `رقم تواصل غير معتمد: ${phones.filter((p) => !approved.includes(p)).join('، ') || 'رقم ناقص'}`
    : !logo ? 'الشعار الأصلي غير موجود في التصميم'
    : glyphGaps.length ? `نص ناقص الحروف: ${glyphGaps.join('، ')}` : undefined;
  const why = Object.fromEntries(Object.entries(reasons).filter(([k, v]) => RUBRIC.some((r) => r.key === k) && typeof v === 'string' && v.trim()).map(([k, v]) => [k, String(v).slice(0, 200)]));
  return { total, parts, reasons: why, weakness: weakness.slice(0, 240), fix: fix.slice(0, 300), passed: total >= threshold && !blocked, threshold, ...(blocked ? { blocked } : {}) };
}
