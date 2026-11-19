import type { Analysis, Brief } from './brief';
import type { Concept } from './concepts';

/**
 * ART DIRECTION PER SIZE — the AI picture is planned for the exact box it will fill on THIS product:
 * the closest model canvas to the box's proportions, a composition that survives the crop, a style that suits the
 * product family (distance-read banners, isolated die-cut art, wrap-safe mug art, transparent DTF art…), the right
 * background (transparent where the art is cut out), and the quality tier for the print size.
 */
export type GenSize = '1024x1024' | '1536x1024' | '1024x1536';
export interface ArtPlan {
  size: GenSize; ratioBox: number; ratioGen: number;
  /** % of the generated picture's width / height kept after the crop to the box */
  keepW: number; keepH: number;
  /** extreme proportions: the picture is generated at the closest canvas and its background extended to the exact box */
  extend: 'none' | 'horizontal' | 'vertical';
  background: 'opaque' | 'transparent';
  quality: 'low' | 'medium' | 'high';
  prompt: string; notes: string[];
}
const SIZES: [GenSize, number][] = [['1024x1024', 1], ['1536x1024', 1.5], ['1024x1536', 2 / 3]];
const NO_TEXT = 'ABSOLUTELY NO text, letters, words, numbers, logos, labels, signatures or watermarks anywhere in the image.';

const FAMILY_STYLE: Record<string, string> = {
  card: 'refined, uncluttered artwork that works small; subtle texture, one clear focal element, generous calm space',
  sheet: 'striking hero image with a clear focal point and professional commercial finish',
  folded: 'clean editorial photograph or illustration that reads well in a narrow brochure panel',
  multipage: 'book-cover quality key art with depth, a strong single focal point and premium finish',
  large_format: 'bold, simple, high-contrast image with big shapes that reads instantly from several metres away; no fine detail that would be lost at distance',
  sticker: 'bold die-cut sticker artwork: ONE isolated subject with clean smooth outlines, flat vibrant colours, strong silhouette, no background scene',
  label: 'product-label artwork: clean, appetising or premium, a single subject with simple background, crisp edges',
  packaging: 'premium packaging artwork: elegant, brand-like, works across a box face, rich materials and lighting',
  wrap: 'mug/tumbler artwork: a centred subject with simple background that stays readable on a curved surface',
  apparel: 'T-shirt print artwork: ONE isolated graphic subject with clean edges, bold flat colours, strong silhouette, no background, no photo-realistic scene, no gradients fading to the edge',
  flat_gift: 'gift-product artwork: warm, personal, centred subject on a simple background',
  stamp: 'single-colour line artwork',
};

function closest(ratio: number): [GenSize, number] { return [...SIZES].sort((a, b) => Math.abs(Math.log(a[1] / ratio)) - Math.abs(Math.log(b[1] / ratio)))[0]; }

export function artPlan(a: Analysis, b: Brief, c: Concept, boxMm: { w: number; h: number } | null): ArtPlan {
  const fam = a.product.family;
  const ratioBox = boxMm && boxMm.h > 0 ? boxMm.w / boxMm.h : a.trim.w / Math.max(1, a.trim.h);
  const [size, ratioGen] = closest(ratioBox);
  const keepW = ratioBox >= ratioGen ? 100 : Math.round((ratioBox / ratioGen) * 100);
  const keepH = ratioBox >= ratioGen ? Math.round((ratioGen / ratioBox) * 100) : 100;
  const extend: ArtPlan['extend'] = ratioBox > ratioGen * 1.25 ? 'horizontal' : ratioBox < ratioGen / 1.25 ? 'vertical' : 'none';
  const background: ArtPlan['background'] = ['sticker', 'apparel'].includes(fam) ? 'transparent' : 'opaque';
  const areaM2 = boxMm ? (boxMm.w * boxMm.h) / 1e6 : (a.trim.w * a.trim.h) / 1e6;
  // big print areas and premium finishes deserve the best tier; tiny boxes do not need it
  const premium = b.finishes.some((f) => /foil|soft_touch|emboss/.test(f)) || ['perfume', 'fine_dining', 'real_estate', 'events'].includes(a.identity.id);
  const quality: ArtPlan['quality'] = areaM2 > 0.25 || premium ? 'high' : areaM2 < 0.004 ? 'low' : 'medium';
  const notes: string[] = [];
  const crop = extend !== 'none'
    ? (extend === 'horizontal'
      ? 'Panoramic feeling: keep the main subject compact in the centre; the left and right edges must be simple, continuous background (sky, gradient, wall, plain surface) with nothing cut at the borders, so the background can be extended sideways.'
      : 'Tall composition: keep the main subject compact in the vertical centre; the top and bottom edges must be simple, continuous background with nothing cut at the borders, so the background can be extended up and down.')
    : keepW < 100 ? `Only the central ${keepW}% of the width will be used: keep the subject well inside that central area.`
      : keepH < 100 ? `Only the central ${keepH}% of the height will be used: keep the subject well inside that central area.` : 'The whole frame is used: balanced composition with breathing room at the edges.';
  if (extend !== 'none') notes.push(`نسبة المساحة ${ratioBox.toFixed(2)}:1 بعيدة عن أقرب نسبة يدعمها النموذج (${size}) — يُوسَّع الخلفية آليًا إلى المقاس الدقيق`);
  else if (keepW < 100 || keepH < 100) notes.push(`يُقص ${100 - Math.min(keepW, keepH)}% من الصورة لتطابق المساحة — التكوين يُبقي الموضوع داخل الجزء المستخدم`);
  if (background === 'transparent') notes.push('خلفية شفافة (قناة ألفا) لتُقص الصورة على شكلها');
  const viewM = b.viewM ?? a.product.viewM;
  const prompt = [
    `Professional ${a.product.en.toLowerCase()} artwork for a ${a.identity.en.toLowerCase()} business${b.business ? ` (the brand name must NOT appear)` : ''}.`,
    b.texts.headline ? `The picture expresses: ${b.texts.headline}.` : '',
    `Visual direction: ${c.idea}. Metaphor: ${c.metaphor}.`,
    `Product-specific style: ${FAMILY_STYLE[fam] ?? FAMILY_STYLE.sheet}.`,
    `Imagery: ${c.imagery}.`,
    `Colour palette: ${c.palette.primary}, ${c.palette.secondary}, ${c.palette.accent}${background === 'transparent' ? '' : `, background in harmony with ${c.palette.bg}`}.`,
    viewM && viewM >= 2 ? `It will be seen from about ${viewM} metres: large readable shapes, strong contrast.` : '',
    `Final crop ${ratioBox.toFixed(2)}:1. ${crop}`,
    background === 'transparent' ? 'Transparent background, the subject fully inside the frame with a small margin, no shadow on the ground, no cast background.' : '',
    'Print quality: sharp focus, clean edges, no compression artefacts, no frame or border.',
    'Culturally appropriate for Bahrain; modest clothing for any people.',
    NO_TEXT,
  ].filter(Boolean).join(' ');
  return { size, ratioBox: Math.round(ratioBox * 100) / 100, ratioGen: Math.round(ratioGen * 100) / 100, keepW, keepH, extend, background, quality, prompt, notes };
}

/**
 * Extends a picture's background to an exact proportion: the picture stays untouched in the middle at its own pixel
 * density; the added sides come from a strongly defocused enlargement of the same picture, blended through feathered
 * edges. It is a background extension (no new subject detail) — stated as such in the plan notes.
 */
export async function extendToRatio(png: Buffer, ratio: number): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  const m = await sharp(png).metadata(); const w = m.width ?? 1, h = m.height ?? 1;
  const horizontal = ratio > w / h;
  const W = horizontal ? Math.round(h * ratio) : w, H = horizontal ? h : Math.round(w / ratio);
  if (W === w && H === h) return png;
  const base = await sharp(png).resize(W, H, { fit: 'cover' }).blur(Math.max(8, Math.round(Math.max(W, H) / 60))).modulate({ brightness: 1.02 }).png().toBuffer();
  const f = Math.round((horizontal ? w : h) * 0.08); // feather width
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="${horizontal ? 1 : 0}" y2="${horizontal ? 0 : 1}"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="${f / (horizontal ? w : h)}" stop-color="#fff" stop-opacity="1"/><stop offset="${1 - f / (horizontal ? w : h)}" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/></svg>`);
  const feathered = await sharp(png).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  return sharp(base).composite([{ input: feathered, left: Math.round((W - w) / 2), top: Math.round((H - h) / 2) }]).removeAlpha().png().toBuffer();
}
