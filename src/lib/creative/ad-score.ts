import type { LayerManifest } from '../render/compose';

/**
 * QUALITY RUBRIC (owner's V10 spec §5) — 100 points, a design is approved for automatic use only at ≥ the threshold
 * (default 95). A quality standard, not a promise of virality.
 *  - 80 points judged by the AI art director on the FINISHED ad (vision): attention 20, creativity 20, image quality 15,
 *    message clarity 15, shareability 10
 *  - 20 points MEASURED, not guessed: brand identity 10 (the original logo layer is there), text accuracy 10 (every
 *    system text layer fits with no missing glyph) — the system guarantees these, a model must not hallucinate them
 */
export const RUBRIC = [
  { key: 'attention', ar: 'قوة جذب الانتباه', max: 20, judged: true },
  { key: 'creativity', ar: 'الإبداع والأصالة', max: 20, judged: true },
  { key: 'image', ar: 'جودة الصورة والواقعية', max: 15, judged: true },
  { key: 'clarity', ar: 'وضوح الرسالة التسويقية', max: 15, judged: true },
  { key: 'brand', ar: 'الهوية التجارية', max: 10, judged: false },
  { key: 'text', ar: 'دقة النصوص والمعلومات', max: 10, judged: false },
  { key: 'share', ar: 'قابلية المشاركة', max: 10, judged: true },
] as const;
export type RubricKey = (typeof RUBRIC)[number]['key'];
export interface AdScore { total: number; parts: Record<RubricKey, number>; weakness: string; fix: string; passed: boolean; threshold: number }

/** The vision instructions (only the judged criteria; JSON answer). */
export function scoreAdPrompt(ctx: { product: string; idea: string; platform: string }) {
  return [
    'You are a demanding creative director at a world-class advertising agency judging a FINISHED social-media ad for a print shop in Bahrain.',
    `Product: ${ctx.product}. Idea: ${ctx.idea}. Platform/format: ${ctx.platform}.`,
    'Score strictly — 95+ only for work that could win an award; ordinary competent work is 60–80. Answer in JSON only:',
    '{"attention": 0-20 (stops the scroll in under a second?), "creativity": 0-20 (original, unexpected, not a stock template?),',
    ' "image": 0-15 (photorealistic, sharp, correct product shape and materials, no AI artefacts, good light?),',
    ' "clarity": 0-15 (product and message understood in 2 seconds, clear hierarchy, readable on a phone?),',
    ' "share": 0-10 (would people send or save it?),',
    ' "weakness": "<the single biggest problem, concrete>", "fix": "<one concrete instruction for the image model to fix it in the next version>"}',
  ].join('\n');
}

const clamp = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));

/** Combines the judged points with the measured ones (logo present, every text layer fits with all glyphs). */
export function combineScore(judged: Partial<Record<RubricKey, unknown>>, manifest: Pick<LayerManifest, 'layers'>, threshold: number, weakness = '', fix = ''): AdScore {
  const textLayers = manifest.layers.filter((l) => l.text && l.text.trim());
  const textOk = textLayers.length > 0 && textLayers.every((l) => l.fits !== false && !(l.missing?.length));
  const parts = Object.fromEntries(RUBRIC.map((r) => [r.key, r.judged ? clamp(judged[r.key], r.max) : 0])) as Record<RubricKey, number>;
  parts.brand = manifest.layers.some((l) => l.id === 'logo') ? 10 : 0;
  parts.text = textOk ? 10 : textLayers.filter((l) => l.fits !== false && !(l.missing?.length)).length >= textLayers.length / 2 ? 5 : 0;
  const total = RUBRIC.reduce((a, r) => a + parts[r.key], 0);
  return { total, parts, weakness: weakness.slice(0, 240), fix: fix.slice(0, 300), passed: total >= threshold, threshold };
}
