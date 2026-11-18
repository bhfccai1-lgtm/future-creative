import sharp from 'sharp';
import { escapeMarkup } from '../render/text';
import { fontFor, missingGlyphs, type Weight } from '../render/fonts';

export interface TextImg { png: Buffer; w: number; h: number; fits: boolean; missing: string[] }
const RTL = /[֐-ࣿ]/;

/** Pango-shaped text (Arabic joins/RTL correct). size in points at the given px-per-mm. */
export async function textImg(str: string, o: { pt: number; kmm: number; w: number; weight?: Weight; color: string; align?: 'left' | 'centre' | 'right'; maxH?: number }): Promise<TextImg> {
  const clean = str.replace(/ﷺ/g, '(صلى الله عليه وسلم)').replace(/[✓✔]/g, '•');
  if (!clean.trim()) return { png: await sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer(), w: 1, h: 1, fits: true, missing: [] };
  const weight = o.weight ?? 'regular';
  const { fontfile, desc } = fontFor('ar', weight);
  const size = Math.max(4, Math.round((o.pt * o.kmm * 25.4) / 72));
  const strong = clean.match(/[A-Za-z֐-ࣿ]/)?.[0];
  const rtl = !!strong && RTL.test(strong);
  const align = o.align ?? (rtl ? 'right' : 'left');
  // Pango mirrors left/right for a right-to-left paragraph
  const pango = rtl && align !== 'centre' ? (align === 'right' ? 'left' : 'right') : align;
  const { data, info } = await sharp({ text: { text: `<span foreground="${o.color}">${escapeMarkup(clean)}</span>`, font: `${desc} ${size}`, fontfile, width: Math.max(10, Math.round(o.w)), rgba: true, align: pango, wrap: 'word', dpi: 72, spacing: -Math.round(size * 0.2) } }).png().toBuffer({ resolveWithObject: true });
  return { png: data, w: info.width, h: info.height, fits: info.width <= o.w + 2 && (!o.maxH || info.height <= o.maxH), missing: missingGlyphs(clean, 'ar', weight) };
}
/** largest point size (from max down to min) at which the text fits the box */
export async function fitText(str: string, o: { maxPt: number; minPt: number; kmm: number; w: number; h: number; weight?: Weight; color: string; align?: 'left' | 'centre' | 'right' }) {
  let pt = o.maxPt, t = await textImg(str, { ...o, pt, maxH: o.h });
  while (!t.fits && pt > o.minPt) { pt = Math.max(o.minPt, pt * 0.88); t = await textImg(str, { ...o, pt, maxH: o.h }); }
  return { ...t, pt };
}
