import sharp from 'sharp';
import type { ShotRecipe } from './photo-recipes';

/**
 * PROFESSIONAL FINISH — the retouch a studio does after the shot, deterministic and free (no AI call):
 *  1) clarity: a gentle unsharp mask on fine detail (labels, print edges, fabric weave)
 *  2) grade: a small, product-appropriate colour grade (warm / crisp / rich / neutral)
 *  3) vignette: a very soft edge fall-off that keeps the eye on the product (opaque pictures only)
 * Safety: every step is measured — if the finished picture clips more highlights/shadows than the original or its
 * brightness moves noticeably, the original is kept. Subtle by design: «retouched», never «filtered».
 */
export interface FinishReport { applied: string[]; skipped?: string; clipBefore: number; clipAfter: number; meanShift: number }

const GRADE: Record<ShotRecipe['grade'], { matrix?: number[][]; saturation: number; contrast: number }> = {
  neutral: { saturation: 1.0, contrast: 1.0 },
  warm: { matrix: [[1.03, 0.01, 0], [0, 1.0, 0], [0, 0, 0.96]], saturation: 1.03, contrast: 1.02 },
  crisp: { matrix: [[0.99, 0, 0], [0, 1.0, 0], [0, 0.01, 1.02]], saturation: 1.02, contrast: 1.04 },
  rich: { saturation: 1.06, contrast: 1.04 },
};

async function tones(png: Buffer) {
  const { data } = await sharp(png).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  let clip = 0, sum = 0;
  for (let i = 0; i < data.length; i++) { const v = data[i]; sum += v; if (v >= 253 || v <= 2) clip++; }
  return { clip: clip / data.length, mean: sum / data.length };
}

export async function finishPhoto(png: Buffer, grade: ShotRecipe['grade'] = 'neutral', o: { vignette?: boolean } = {}): Promise<{ png: Buffer; report: FinishReport }> {
  const meta = await sharp(png).metadata();
  const W = meta.width ?? 0, H = meta.height ?? 0;
  const alpha = !!meta.hasAlpha;
  const before = await tones(png);
  const g = GRADE[grade];
  const applied: string[] = [];
  let img = sharp(png).sharpen({ sigma: 0.8, m1: 0.5, m2: 1.4 });
  applied.push('clarity');
  if (g.matrix) { img = img.recomb(g.matrix as [[number, number, number], [number, number, number], [number, number, number]]); applied.push(`grade:${grade}`); }
  if (g.saturation !== 1) { img = img.modulate({ saturation: g.saturation }); if (!applied.includes(`grade:${grade}`)) applied.push(`grade:${grade}`); }
  // contrast around mid-grey (128) so the average brightness does not drift
  if (g.contrast !== 1) img = img.linear(g.contrast, 128 * (1 - g.contrast));
  let out = await img.png().toBuffer();
  if (o.vignette !== false && !alpha && W && H) {
    const v = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><radialGradient id="v" cx="0.5" cy="0.5" r="0.75"><stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.14"/></radialGradient></defs><rect width="${W}" height="${H}" fill="url(#v)"/></svg>`);
    out = await sharp(out).composite([{ input: v, blend: 'multiply' }]).png().toBuffer();
    applied.push('vignette');
  }
  const after = await tones(out);
  const meanShift = Math.abs(after.mean - before.mean) / 255;
  // measured safety: more clipping (>0.5 % of pixels) or a visible brightness change (>4 %) → keep the original
  if (after.clip - before.clip > 0.005 || meanShift > 0.04) {
    return { png, report: { applied: [], skipped: after.clip - before.clip > 0.005 ? 'clipping' : 'brightness', clipBefore: before.clip, clipAfter: after.clip, meanShift } };
  }
  return { png: out, report: { applied, clipBefore: before.clip, clipAfter: after.clip, meanShift: Math.round(meanShift * 1000) / 1000 } };
}
