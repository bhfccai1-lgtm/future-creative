import sharp from 'sharp';
import type { MediaFormat } from '@prisma/client';
import { renderText, type RenderedText } from './text';
import { FORMAT_SIZE, getTemplate, px } from './templates';
import { AI_POSTER_KEY, POSTER_KEY, buildAiPosterBackground, buildPosterBackground, composeAiPoster, composePoster } from './poster';
import type { Lang } from './fonts';

export const COLORS = { navy: '#0b1730', navyMid: '#13265a', gold: '#d4af37', goldLight: '#ecd58c', white: '#ffffff' };

/** Layout colour themes (chosen via "أسلوب التصميم"). Contrast is still verified by QC for every design. */
export interface Theme { shade: string; panel: string; accent: string; headline: string; support: string; label: string; phone: string; ctaBg: string; ctaText: string }
export const THEMES: Record<'navy_gold' | 'black_gold' | 'white_minimal' | 'emerald_gold' | 'festive_red', Theme> = {
  navy_gold: { shade: COLORS.navy, panel: COLORS.navy, accent: COLORS.gold, headline: COLORS.white, support: COLORS.goldLight, label: COLORS.gold, phone: COLORS.white, ctaBg: COLORS.gold, ctaText: COLORS.navy },
  black_gold: { shade: '#080808', panel: '#0d0d0d', accent: '#c9a227', headline: '#ffffff', support: '#ead38c', label: '#d4af37', phone: '#ffffff', ctaBg: '#d4af37', ctaText: '#0d0d0d' },
  white_minimal: { shade: '#ffffff', panel: '#ffffff', accent: '#0b1730', headline: '#0b1730', support: '#334155', label: '#7a5c0f', phone: '#0b1730', ctaBg: '#0b1730', ctaText: '#ffffff' },
  emerald_gold: { shade: '#052b22', panel: '#06352a', accent: '#d4af37', headline: '#ffffff', support: '#ecd58c', label: '#d4af37', phone: '#ffffff', ctaBg: '#d4af37', ctaText: '#06352a' },
  festive_red: { shade: '#3f0a0f', panel: '#5a0f16', accent: '#f4c95d', headline: '#ffffff', support: '#ffe3a3', label: '#f4c95d', phone: '#ffffff', ctaBg: '#f4c95d', ctaText: '#5a0f16' },
};
export type ThemeKey = keyof typeof THEMES;

export interface ContactLine { key: string; label: string; phone: string }

export interface ComposeInput {
  scene: Buffer; format: MediaFormat; lang: Lang; templateKey?: string | null;
  headline: string; supportingCopy?: string | null; cta: string;
  logo: Buffer; contacts: ContactLine[];
  theme?: ThemeKey;
  /** Gold-poster layout only: product keyword in the gold badge + benefit badges. */
  badge?: string | null;
  features?: string[];
}

export interface PlacedLayer {
  id: 'headline' | 'support' | 'logo' | 'cta' | `contact:${string}:label` | `contact:${string}:phone` | 'panel';
  text?: string; png: Buffer; left: number; top: number; width: number; height: number;
  box: { x: number; y: number; w: number; h: number }; fits: boolean; missing: string[]; fontSize?: number; color?: string;
}

export interface ComposeResult {
  width: number; height: number; templateKey: string; themeKey: ThemeKey;
  background: Buffer; // scene + shading + panels, no text/logo — used as the moving layer for video
  layers: PlacedLayer[]; // deterministic overlay layers in z-order
  png: Buffer; // final lossless composite
  manifest: LayerManifest;
}

export interface LayerManifest {
  width: number; height: number; templateKey: string; lang: Lang;
  layers: { id: string; text?: string; rect: { left: number; top: number; width: number; height: number }; box: { x: number; y: number; w: number; h: number }; fits: boolean; missing: string[]; fontSize?: number; color?: string; solid?: boolean }[];
}

const shadeSvg = (W: number, H: number, from: number, to: number, dir: 'down' | 'up', color: string = COLORS.navy) => {
  const y = Math.round(from * H), h = Math.round((to - from) * H);
  const [a, m, b] = dir === 'down' ? ['0.94', '0.86', '0'] : ['0', '0.86', '0.94'];
  const mid = dir === 'down' ? '0.72' : '0.28';
  return `<rect x="0" y="${y}" width="${W}" height="${h}" fill="url(#sh${from})"/><defs><linearGradient id="sh${from}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="${a}"/><stop offset="${mid}" stop-color="${color}" stop-opacity="${m}"/><stop offset="1" stop-color="${color}" stop-opacity="${b}"/></linearGradient></defs>`;
};

function center(r: RenderedText, box: { x: number; y: number; w: number; h: number }, v: 'middle' | 'top' | 'bottom' = 'middle') {
  const w = Math.min(r.width, box.w), h = Math.min(r.height, box.h);
  const top = v === 'top' ? box.y : v === 'bottom' ? box.y + box.h - h : box.y + Math.round((box.h - h) / 2);
  return { left: box.x + Math.round((box.w - w) / 2), top, width: w, height: h };
}

/** Crop image to box if it overflowed (only possible when fits=false, which QC rejects anyway). */
async function clip(png: Buffer, w: number, h: number) {
  const m = await sharp(png).metadata();
  if ((m.width ?? 0) <= w && (m.height ?? 0) <= h) return png;
  return sharp(png).extract({ left: 0, top: 0, width: Math.min(w, m.width!), height: Math.min(h, m.height!) }).png().toBuffer();
}

/**
 * Assembles the final advertisement from SEPARATE deterministic layers:
 *  1 scene · 2 headline · 3 supporting copy · 4 ORIGINAL logo (resized only, aspect preserved) ·
 *  5/6 contact blocks per location · 7 CTA.
 * The AI never draws text, numbers or the logo.
 */
export async function composeAdvertisement(input: ComposeInput): Promise<ComposeResult> {
  if (input.templateKey === AI_POSTER_KEY) return composeAiPoster(input); // every format (2:3 or 1:1 design, never cropped)
  if (input.templateKey === POSTER_KEY && FORMAT_SIZE[input.format].h === 1920) return composePoster(input);
  const { w: W, h: H } = FORMAT_SIZE[input.format];
  const t = getTemplate(input.templateKey);
  const scale = W / 1080;

  const th = THEMES[input.theme ?? 'navy_gold'];
  const background = await buildBackground(input.scene, input.format, t.key, input.contacts.length, input.theme);


  const layers: PlacedLayer[] = [];

  // ── Layer 2: headline ──
  const hb = px(t.headline, W, H);
  const head = await renderText({ text: input.headline, lang: input.lang, weight: 'extrabold', color: th.headline, maxSize: Math.round(t.headline.maxSize * scale), minSize: Math.round(t.headline.minSize * scale), boxW: hb.w, boxH: hb.h, maxLines: t.headline.maxLines });
  layers.push({ id: 'headline', text: input.headline, png: await clip(head.png, hb.w, hb.h), ...center(head, hb), box: hb, fits: head.fits, missing: head.missing, fontSize: head.fontSize, color: th.headline });

  // ── Layer 3: supporting copy (optional) ──
  if (input.supportingCopy?.trim()) {
    const sb = px(t.support, W, H);
    const sup = await renderText({ text: input.supportingCopy.trim(), lang: input.lang, weight: 'bold', color: th.support, maxSize: Math.round(t.support.maxSize * scale), minSize: Math.round(t.support.minSize * scale), boxW: sb.w, boxH: sb.h, maxLines: t.support.maxLines });
    layers.push({ id: 'support', text: input.supportingCopy.trim(), png: await clip(sup.png, sb.w, sb.h), ...center(sup, sb), box: sb, fits: sup.fits, missing: sup.missing, fontSize: sup.fontSize, color: th.support });
  }

  // ── Layer 4: ORIGINAL logo — proportional resize only, no recolouring ──
  const lb = px(t.logo, W, H);
  const logoPng = await sharp(input.logo).resize(lb.w, lb.h, { fit: 'inside', kernel: 'lanczos3', withoutEnlargement: false }).png().toBuffer();
  const lm = await sharp(logoPng).metadata();
  layers.push({ id: 'logo', png: logoPng, left: lb.x + Math.round((lb.w - lm.width!) / 2), top: lb.y + Math.round((lb.h - lm.height!) / 2), width: lm.width!, height: lm.height!, box: lb, fits: true, missing: [] });

  // ── Layer 7: CTA pill ──
  const cb = px(t.cta, W, H);
  const pill = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cb.w}" height="${cb.h}"><rect width="${cb.w}" height="${cb.h}" rx="${Math.round(cb.h / 2)}" fill="${th.ctaBg}"/></svg>`);
  const ctaText = await renderText({ text: input.cta, lang: input.lang, weight: 'extrabold', color: th.ctaText, maxSize: Math.round(t.cta.maxSize * scale), minSize: Math.round(t.cta.minSize * scale), boxW: Math.round(cb.w * 0.86), boxH: Math.round(cb.h * 0.96), maxLines: 1 });
  const ctaInner = center(ctaText, { x: 0, y: 0, w: cb.w, h: cb.h });
  const ctaPng = await sharp(pill).composite([{ input: await clip(ctaText.png, Math.round(cb.w * 0.86), Math.round(cb.h * 0.96)), left: ctaInner.left, top: ctaInner.top }]).png().toBuffer();
  layers.push({ id: 'cta', text: input.cta, png: ctaPng, left: cb.x, top: cb.y, width: cb.w, height: cb.h, box: cb, fits: ctaText.fits, missing: ctaText.missing, fontSize: ctaText.fontSize, color: th.ctaText });

  // ── Layers 5/6: contact blocks (RTL order for Arabic: first location on the right) ──
  const n = input.contacts.length;
  const padX = Math.round(t.contacts.padX * W), gap = Math.round(t.contacts.gap * W);
  const cardW = Math.floor((W - 2 * padX - gap * (n - 1)) / Math.max(1, n));
  const cy = Math.round(t.contacts.y * H), ch = Math.round(t.contacts.h * H);
  const order = input.lang === 'ar' ? [...input.contacts].reverse() : input.contacts;
  for (let i = 0; i < order.length; i++) {
    const c = order[i];
    const x = padX + i * (cardW + gap);
    const labelBox = { x, y: cy, w: cardW, h: Math.round(ch * 0.36) };
    const phoneBox = { x, y: cy + Math.round(ch * 0.36), w: cardW, h: Math.round(ch * 0.64) };
    const label = await renderText({ text: c.label, lang: input.lang, weight: 'bold', color: th.label, maxSize: Math.round(36 * scale), minSize: Math.round(24 * scale), boxW: labelBox.w, boxH: labelBox.h, maxLines: 1 });
    // Phone digits are always Latin digits rendered with the Cairo font, isolated as LTR
    const phone = await renderText({ text: c.phone, lang: input.lang === 'ml' ? 'en' : input.lang, weight: 'extrabold', color: th.phone, maxSize: Math.round(60 * scale), minSize: Math.round(34 * scale), boxW: phoneBox.w, boxH: phoneBox.h, maxLines: 1, ltr: true });
    // Stack label + gap + number, vertically centred in the card
    const gapPx = Math.round(14 * scale);
    const stackH = Math.min(label.height, labelBox.h) + gapPx + Math.min(phone.height, phoneBox.h);
    const top0 = cy + Math.max(0, Math.round((ch - stackH) / 2));
    const lp = center(label, labelBox); lp.top = top0;
    const pp = center(phone, phoneBox); pp.top = top0 + Math.min(label.height, labelBox.h) + gapPx;
    layers.push({ id: `contact:${c.key}:label`, text: c.label, png: await clip(label.png, labelBox.w, labelBox.h), ...lp, box: labelBox, fits: label.fits, missing: label.missing, fontSize: label.fontSize, color: th.label });
    layers.push({ id: `contact:${c.key}:phone`, text: c.phone, png: await clip(phone.png, phoneBox.w, phoneBox.h), ...pp, box: phoneBox, fits: phone.fits, missing: phone.missing, fontSize: phone.fontSize, color: th.phone });
  }

  const png = await sharp(background).composite(layers.map((l) => ({ input: l.png, left: l.left, top: l.top }))).png().toBuffer();

  const manifest: LayerManifest = {
    width: W, height: H, templateKey: t.key, lang: input.lang,
    layers: layers.map((l) => ({ id: l.id, text: l.text, rect: { left: l.left, top: l.top, width: l.width, height: l.height }, box: l.box, fits: l.fits, missing: l.missing, fontSize: l.fontSize, color: l.color })),
  };
  return { width: W, height: H, templateKey: t.key, themeKey: input.theme ?? 'navy_gold', background, layers, png, manifest };
}


/**
 * Layer 1 + static decoration (shading, bottom panel, dividers, frame) for a scene.
 * Exported so pro reels can build extra scenes with exactly the same layout.
 */
export async function buildBackground(sceneBuf: Buffer, format: MediaFormat, templateKey: string | null | undefined, contactsCount: number, themeKey: ThemeKey = 'navy_gold', featureCount = 4): Promise<Buffer> {
  if (templateKey === AI_POSTER_KEY) return buildAiPosterBackground(sceneBuf, FORMAT_SIZE[format].h);
  if (templateKey === POSTER_KEY && FORMAT_SIZE[format].h === 1920) return buildPosterBackground(sceneBuf, featureCount);
  const { w: W, h: H } = FORMAT_SIZE[format];
  const t = getTemplate(templateKey);
  const scale = W / 1080;
  const th = THEMES[themeKey];
  // ── Layer 1: scene, cover-fit to canvas (centre crop) ──
  const scene = await sharp(sceneBuf).resize(W, H, { fit: 'cover', position: 'attention' }).removeAlpha().png().toBuffer();

  // ── Static background decorations (shades, bottom panel, frame) ──
  const panelY = Math.round(t.panel.y * H);
  const deco = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    ${t.shade.map((s) => shadeSvg(W, H, s.from, s.to, s.dir, th.shade)).join('')}
    <rect x="0" y="${panelY}" width="${W}" height="${H - panelY}" fill="${th.panel}" fill-opacity="0.94"/>
    <rect x="0" y="${panelY}" width="${W}" height="${Math.max(3, Math.round(5 * scale))}" fill="${th.accent}"/>
    ${Array.from({ length: Math.max(0, contactsCount - 1) }, (_, i) => { const n = contactsCount; const pad = t.contacts.padX * W; const g = t.contacts.gap * W; const cw = (W - 2 * pad - g * (n - 1)) / n; const xx = Math.round(pad + (i + 1) * cw + i * g + g / 2); return `<rect x="${xx - 1}" y="${Math.round((t.contacts.y + 0.015) * H)}" width="2" height="${Math.round((t.contacts.h - 0.03) * H)}" fill="${th.accent}" fill-opacity="0.6"/>`; }).join('')}
    ${t.frame ? `<rect x="${Math.round(22 * scale)}" y="${Math.round(22 * scale)}" width="${W - Math.round(44 * scale)}" height="${H - Math.round(44 * scale)}" fill="none" stroke="${th.accent}" stroke-width="${Math.round(4 * scale)}" rx="${Math.round(18 * scale)}"/>` : ''}
  </svg>`;
  const background = await sharp(scene).composite([{ input: Buffer.from(deco) }]).png().toBuffer();
  return background;
}

/** Instagram's publishing API accepts JPEG for still images; export a high-quality JPEG. */
export const toJpeg = (png: Buffer) => sharp(png).flatten({ background: COLORS.navy }).jpeg({ quality: 92, chromaSubsampling: '4:4:4', mozjpeg: true }).toBuffer();
