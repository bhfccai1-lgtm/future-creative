import type { LayerManifest } from '../render/compose';

/**
 * «مؤشر الخوارزمية» — the owner's internal pre-publication score (creative-director spec §6), 100 points. An editorial
 * estimate, NOT an official platform score and no promise of reach. A design is used automatically only at ≥ the
 * threshold (default 95, owner's V10 rule); a wrong phone number or brand name blocks approval whatever the total.
 *  - JUDGED by the art director on the finished ad (vision), each with a reason:
 *      hook 20 · product & benefit clarity 20 · format fit 15 · value for the audience 15
 *  - MEASURED (never guessed — the system guarantees or can check them):
 *      ease of action 15 = order button 5 + both branches' numbers 5 + a call to action in the caption 5
 *      execution 15      = every text layer fits with all glyphs 7 + the original logo 4 + the phones exactly the approved ones 4
 */
export const RUBRIC = [
  { key: 'hook', ar: 'قوة الافتتاحية', max: 20, judged: true },
  { key: 'clarity', ar: 'وضوح المنتج والفائدة', max: 20, judged: true },
  { key: 'format', ar: 'ملاءمة الصيغة', max: 15, judged: true },
  { key: 'value', ar: 'قيمة المحتوى للجمهور', max: 15, judged: true },
  { key: 'action', ar: 'سهولة اتخاذ الإجراء', max: 15, judged: false },
  { key: 'execution', ar: 'جودة التنفيذ', max: 15, judged: false },
] as const;
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
    '{"hook": 0-20 (does the first look give THIS audience a reason to stop scrolling?),',
    ' "clarity": 0-20 (is it obvious what is sold and why it matters to the buyer, within 2 seconds?),',
    ' "format": 0-15 (is the format used for the idea: vertical framing, hierarchy, room for the text, phone-size readability?),',
    ' "value": 0-15 (a detail worth sending, saving or that helps the customer choose?),',
    ' "reasons": {"hook": "...", "clarity": "...", "format": "...", "value": "..."},',
    ' "weakness": "<the single weakest element, concrete>", "fix": "<ONE concrete change for the image model that fixes it>"}',
  ].join('\n');
}

const clamp = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
const CTA = /اطلب|اطلبي|راسل|تواصل|واتساب|احجز|للطلب|order|dm\b|message|whatsapp|book|ऑर्डर|ഓർഡർ/i;

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
  parts.action = (L.some((l) => l.id === 'cta') ? 5 : 0) + (phones.length >= 2 ? 5 : phones.length ? 2 : 0) + (ctx.caption === undefined ? 5 : CTA.test(ctx.caption) ? 5 : 0);
  parts.execution = (textLayers.length && okText === textLayers.length ? 7 : okText >= textLayers.length / 2 ? 3 : 0) + (L.some((l) => l.id === 'logo') ? 4 : 0) + (phonesExact ? 4 : 0);
  const total = RUBRIC.reduce((a, r) => a + parts[r.key], 0);
  const blocked = approved.length && phones.length && !phonesExact ? `رقم تواصل غير معتمد: ${phones.filter((p) => !approved.includes(p)).join('، ') || 'رقم ناقص'}` : undefined;
  const why = Object.fromEntries(Object.entries(reasons).filter(([k, v]) => RUBRIC.some((r) => r.key === k) && typeof v === 'string' && v.trim()).map(([k, v]) => [k, String(v).slice(0, 200)]));
  return { total, parts, reasons: why, weakness: weakness.slice(0, 240), fix: fix.slice(0, 300), passed: total >= threshold && !blocked, threshold, ...(blocked ? { blocked } : {}) };
}
