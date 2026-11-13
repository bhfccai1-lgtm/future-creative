import sharp, { type OverlayOptions } from 'sharp';
import { renderText } from './text';
import { COLORS, THEMES, type ComposeResult, type ThemeKey } from './compose';
import type { Lang } from './fonts';

export interface Slide { title: string; body: string }
export interface CarouselResult { slides: Buffer[]; problems: string[] }

const W = 1080, H = 1350;
const SWIPE: Record<Lang, string> = { ar: 'اسحب للمزيد', en: 'Swipe for more', ml: 'കൂടുതൽ കാണാൻ സ്വൈപ്പ് ചെയ്യൂ' };
const SAVE: Record<Lang, string> = { ar: 'احفظ المنشور وأرسله لمن يحتاجه', en: 'Save this post & send it to a friend', ml: 'ഈ പോസ്റ്റ് സേവ് ചെയ്ത് സുഹൃത്തിന് അയയ്ക്കൂ' };

/** Truthful, generic fill-in slides (no prices, times or promises) used when the brief returned fewer than 3. */
export const FALLBACK_SLIDES: Record<Lang, Slide[]> = {
  ar: [
    { title: 'اختر المنتج', body: 'أكواب، ملصقات، مطبوعات، هدايا مخصصة ولوحات — حسب مناسبتك أو مشروعك.' },
    { title: 'أرسل فكرتك', body: 'صورة، اسم، عبارة أو شعار — ونحوّلها إلى تصميم يناسبك.' },
    { title: 'تواصل مع أقرب فرع', body: 'فرعا سار وسلماباد جاهزان لاستقبال طلبك واستفساراتك.' },
  ],
  en: [
    { title: 'Pick your product', body: 'Mugs, stickers, prints, custom gifts and signs — for your occasion or business.' },
    { title: 'Send your idea', body: 'A photo, a name, a phrase or a logo — we turn it into a design that fits you.' },
    { title: 'Contact the nearest branch', body: 'Our Saar and Salmabad branches are ready for your order and questions.' },
  ],
  ml: [
    { title: 'ഉൽപ്പന്നം തിരഞ്ഞെടുക്കൂ', body: 'മഗ്ഗുകൾ, സ്റ്റിക്കറുകൾ, പ്രിന്റുകൾ, കസ്റ്റം ഗിഫ്റ്റുകൾ — നിങ്ങളുടെ ആവശ്യത്തിന്.' },
    { title: 'നിങ്ങളുടെ ആശയം അയയ്ക്കൂ', body: 'ഫോട്ടോ, പേര്, വാചകം അല്ലെങ്കിൽ ലോഗോ — ഞങ്ങൾ ഡിസൈനാക്കും.' },
    { title: 'അടുത്തുള്ള ബ്രാഞ്ചുമായി ബന്ധപ്പെടൂ', body: 'സാർ, സൽമാബാദ് ബ്രാഞ്ചുകൾ നിങ്ങളുടെ ഓർഡറിനായി തയ്യാർ.' },
  ],
};

export function normaliseSlides(slides: Slide[] | undefined, lang: Lang): Slide[] {
  const clean = (slides ?? []).filter((s) => s.title?.trim() && s.body?.trim()).slice(0, 4);
  return clean.length >= 3 ? clean : [...clean, ...FALLBACK_SLIDES[lang]].slice(0, Math.max(3, clean.length));
}

async function backdrop(scene: Buffer, themeKey: ThemeKey) {
  const th = THEMES[themeKey];
  const blurred = await sharp(scene).resize(W, H, { fit: 'cover' }).blur(28).modulate({ brightness: 0.7 }).png().toBuffer();
  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="${th.panel}" fill-opacity="0.82"/><rect x="36" y="36" width="${W - 72}" height="${H - 72}" rx="28" fill="none" stroke="${th.accent}" stroke-width="3" stroke-opacity="0.9"/></svg>`;
  return sharp(blurred).composite([{ input: Buffer.from(overlay) }]).png().toBuffer();
}

const centreLeft = (w: number) => Math.round((W - w) / 2);

/**
 * Renders the inner slides + a final save/CTA slide for an Instagram carousel (1080×1350 each).
 * Text goes through the same Pango/HarfBuzz renderer as the posters (correct Arabic & Malayalam);
 * any text that cannot fit or has missing glyphs is reported in `problems` → QC blocks publishing.
 */
export async function renderCarousel(c: ComposeResult, scene: Buffer, slidesIn: Slide[], lang: Lang): Promise<CarouselResult> {
  const themeKey = c.themeKey ?? 'navy_gold';
  const th = THEMES[themeKey];
  const bg = await backdrop(scene, themeKey);
  const logo = c.layers.find((l) => l.id === 'logo');
  const smallLogo = logo ? await sharp(logo.png).resize(260, 90, { fit: 'inside' }).png().toBuffer() : null;
  const contacts = c.layers.filter((l) => l.id.startsWith('contact:'));
  const cta = c.layers.find((l) => l.id === 'cta');
  const problems: string[] = [];
  const slides = normaliseSlides(slidesIn, lang);
  const total = slides.length + 2; // cover + inner + final
  const out: Buffer[] = [];

  const footerH = contacts.reduce((a, l) => a + Math.round(l.height * 0.7) + 8, 0);
  const footerTop = H - 70 - footerH;
  const footer = async (comps: OverlayOptions[]) => {
    // compact contact strip on every slide so a screenshot/share always carries both branches
    let y = footerTop;
    for (const l of contacts) {
      const small = await sharp(l.png).resize(Math.round(l.width * 0.7)).png().toBuffer();
      const m = await sharp(small).metadata();
      comps.push({ input: small, left: centreLeft(m.width!), top: y });
      y += m.height! + 8;
    }
  };

  // progress dots (cover = 1): tells the viewer how many slides are left — professional carousels always show it
  const dots = (active: number) => {
    const n = total, gap = 14, d = 14, wActive = 40;
    const w = (n - 1) * (d + gap) + wActive;
    let x = 0; const parts: string[] = [];
    for (let k = 0; k < n; k++) {
      const on = k === active;
      parts.push(`<rect x="${x}" y="0" width="${on ? wActive : d}" height="${d}" rx="${d / 2}" fill="${on ? th.accent : '#ffffff'}" fill-opacity="${on ? 1 : k < active ? 0.75 : 0.3}"/>`);
      x += (on ? wActive : d) + gap;
    }
    return { svg: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${d}">${parts.join('')}</svg>`), w };
  };
  // each inner slide shows the product from the same AI scene at a different crop/zoom (no extra image cost)
  const PHOTO_W = 940, PHOTO_TOP = 210, PHOTO_HEIGHTS = [480, 400, 330]; // big photo when the text allows, smaller for long text (e.g. Malayalam)
  const sceneMeta = await sharp(scene).metadata();
  const photo = async (k: number, PHOTO_H: number) => {
    const zoom = [1, 0.8, 0.66, 0.9][k % 4];
    const sw = Math.round(sceneMeta.width! * zoom), sh = Math.round(sceneMeta.height! * zoom);
    const left = Math.round((sceneMeta.width! - sw) / 2), top = Math.round((sceneMeta.height! - sh) * [0.5, 0.45, 0.55, 0.4][k % 4]);
    const img = await sharp(scene).extract({ left, top, width: sw, height: sh }).resize(PHOTO_W, PHOTO_H, { fit: 'cover', position: 'attention' }).png().toBuffer();
    const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${PHOTO_W}" height="${PHOTO_H}"><rect width="${PHOTO_W}" height="${PHOTO_H}" rx="34" fill="#fff"/></svg>`);
    const rounded = await sharp(img).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
    const frame = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${PHOTO_W + 12}" height="${PHOTO_H + 12}"><rect x="3" y="3" width="${PHOTO_W + 6}" height="${PHOTO_H + 6}" rx="37" fill="none" stroke="${th.accent}" stroke-width="5"/></svg>`);
    return { rounded, frame };
  };

  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    const comps: OverlayOptions[] = [];
    if (smallLogo) { const m = await sharp(smallLogo).metadata(); comps.push({ input: await sharp(smallLogo).resize(200, 70, { fit: 'inside' }).png().toBuffer(), left: centreLeft(Math.min(200, m.width!)), top: 56 }); }
    const dd = dots(i + 1);
    comps.push({ input: dd.svg, left: centreLeft(dd.w), top: 150 });
    const swipe = await renderText({ text: SWIPE[lang], lang, weight: 'bold', color: th.accent, maxSize: 32, minSize: 24, boxW: 640, boxH: 56 });
    const swipeTop = footerTop - swipe.height - 40;
    // adaptive layout: try the biggest photo whose text block still fits completely
    let lay!: { h: number; titleTop: number; lineY: number; bodyTop: number; title: Awaited<ReturnType<typeof renderText>>; body: Awaited<ReturnType<typeof renderText>> };
    for (const h of PHOTO_HEIGHTS) {
      const titleTop = PHOTO_TOP + h + 44;
      const title = await renderText({ text: s.title, lang, weight: 'extrabold', color: COLORS.white, maxSize: 66, minSize: 38, boxW: 900, boxH: 170, maxLines: 2 });
      const lineY = titleTop + title.height + 26;
      const bodyTop = lineY + 32;
      const body = await renderText({ text: s.body, lang, weight: 'regular', color: COLORS.goldLight, maxSize: 44, minSize: 28, boxW: 880, boxH: Math.max(120, swipeTop - 24 - bodyTop), maxLines: 4 });
      lay = { h, titleTop, lineY, bodyTop, title, body };
      if (body.fits && bodyTop + body.height <= swipeTop - 12) break;
    }
    const { h: PHOTO_H, titleTop, lineY, bodyTop, title, body } = lay;
    const ph = await photo(i, PHOTO_H);
    comps.push({ input: ph.frame, left: centreLeft(PHOTO_W + 12), top: PHOTO_TOP - 6 });
    comps.push({ input: ph.rounded, left: centreLeft(PHOTO_W), top: PHOTO_TOP });
    // number badge on the photo's top corner
    const num = await renderText({ text: String(i + 2).padStart(2, '0'), lang: 'en', weight: 'extrabold', color: '#0b1730', maxSize: 54, minSize: 40, boxW: 120, boxH: 70, ltr: true });
    const badge = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="112" height="112"><circle cx="56" cy="56" r="52" fill="${th.accent}"/><circle cx="56" cy="56" r="52" fill="none" stroke="#ffffff" stroke-opacity="0.9" stroke-width="4"/></svg>`);
    const bx = W - centreLeft(PHOTO_W) - 112 + 20, by = PHOTO_TOP - 36;
    comps.push({ input: badge, left: bx, top: by });
    comps.push({ input: num.png, left: bx + Math.round((112 - num.width) / 2), top: by + Math.round((112 - num.height) / 2) });
    comps.push({ input: title.png, left: centreLeft(title.width), top: titleTop });
    comps.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="140" height="6"><rect width="140" height="6" rx="3" fill="${th.accent}"/></svg>`), left: centreLeft(140), top: lineY });
    comps.push({ input: body.png, left: centreLeft(body.width), top: bodyTop });
    // arrow drawn as a vector (fonts may not contain ←); Instagram always swipes to the left
    const arrow = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="54" height="30"><path d="M50 15H8M20 3L6 15l14 12" fill="none" stroke="${th.accent}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
    const groupW = swipe.width + 18 + 54, gx = centreLeft(groupW);
    comps.push({ input: arrow, left: gx, top: swipeTop + Math.max(0, Math.round((swipe.height - 30) / 2)) });
    comps.push({ input: swipe.png, left: gx + 54 + 18, top: swipeTop });
    if (bodyTop + body.height > swipeTop - 12) problems.push(`الشريحة ${i + 2}: النص يتداخل مع أسفل الشريحة`);
    await footer(comps);
    for (const [label, t] of [['title', title], ['body', body], ['swipe', swipe]] as const) {
      if (!t.fits) problems.push(`الشريحة ${i + 2}: نص ${label === 'title' ? 'العنوان' : label === 'body' ? 'الشرح' : 'السحب'} لا يتسع`);
      if (t.missing.length) problems.push(`الشريحة ${i + 2}: حروف غير مدعومة ${t.missing.join('')}`);
    }
    out.push(await sharp(bg).composite(comps).jpeg({ quality: 92, chromaSubsampling: '4:4:4', mozjpeg: true }).toBuffer());
  }

  // final slide: logo, save/share prompt, official CTA, both branches
  const comps: OverlayOptions[] = [];
  { const dd = dots(total - 1); comps.push({ input: dd.svg, left: centreLeft(dd.w), top: 90 }); }
  if (logo) { const big = await sharp(logo.png).resize(560, 220, { fit: 'inside' }).png().toBuffer(); const m = await sharp(big).metadata(); comps.push({ input: big, left: centreLeft(m.width!), top: 170 }); }
  const save = await renderText({ text: SAVE[lang], lang, weight: 'extrabold', color: COLORS.white, maxSize: 64, minSize: 36, boxW: 900, boxH: 230, maxLines: 3 });
  comps.push({ input: save.png, left: centreLeft(save.width), top: 470 });
  if (!save.fits) problems.push('الشريحة الأخيرة: نص الحفظ لا يتسع');
  if (cta) comps.push({ input: cta.png, left: centreLeft(cta.width), top: 470 + save.height + 70 });
  let y = 470 + save.height + 70 + (cta?.height ?? 0) + 60;
  for (const l of contacts) { comps.push({ input: l.png, left: centreLeft(l.width), top: y }); y += l.height + 14; }
  if (y > H - 50) problems.push('الشريحة الأخيرة: أرقام التواصل تتجاوز حدود الصورة');
  out.push(await sharp(bg).composite(comps).jpeg({ quality: 92, chromaSubsampling: '4:4:4', mozjpeg: true }).toBuffer());

  if (out.length + 1 !== total) problems.push('عدد الشرائح غير صحيح');
  return { slides: out, problems };
}
