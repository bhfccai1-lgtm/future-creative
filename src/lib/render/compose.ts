import sharp from 'sharp';
import type { MediaFormat } from '@prisma/client';
import { renderText, type RenderedText } from './text';
import { FORMAT_SIZE, getTemplate, px } from './templates';
import type { Lang } from './fonts';

export const COLORS = { navy: '#0b1730', navyMid: '#13265a', gold: '#d4af37', goldLight: '#ecd58c', white: '#ffffff' };

export interface ContactLine { key: string; label: string; phone: string }

export interface ComposeInput {
  scene: Buffer; format: MediaFormat; lang: Lang; templateKey?: string | null;
  headline: string; supportingCopy?: string | null; cta: string;
  logo: Buffer; contacts: ContactLine[];
}

export interface PlacedLayer {
  id: 'headline' | 'support' | 'logo' | 'cta' | `contact:${string}:label` | `contact:${string}:phone` | 'panel';
  text?: string; png: Buffer; left: number; top: number; width: number; height: number;
  box: { x: number; y: number; w: number; h: number }; fits: boolean; missing: string[]; fontSize?: number; color?: string;
}

export interface ComposeResult {
  width: number; height: number; templateKey: string;
  background: Buffer; // scene + shading + panels, no text/logo — used as the moving layer for video
  layers: PlacedLayer[]; // deterministic overlay layers in z-order
  png: Buffer; // final lossless composite
  manifest: LayerManifest;
}

export interface LayerManifest {
  width: number; height: number; templateKey: string; lang: Lang;
  layers: { id: string; text?: string; rect: { left: number; top: number; width: number; height: number }; box: { x: number; y: number; w: number; h: number }; fits: boolean; missing: string[]; fontSize?: number; color?: string }[];
}

const shadeSvg = (W: number, H: number, from: number, to: number, dir: 'down' | 'up') => {
  const y = Math.round(from * H), h = Math.round((to - from) * H);
  const [a, b] = dir === 'down' ? ['0.92', '0'] : ['0', '0.92'];
  return `<rect x="0" y="${y}" width="${W}" height="${h}" fill="url(#sh${from})"/><defs><linearGradient id="sh${from}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${COLORS.navy}" stop-opacity="${a}"/><stop offset="1" stop-color="${COLORS.navy}" stop-opacity="${b}"/></linearGradient></defs>`;
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
  const { w: W, h: H } = FORMAT_SIZE[input.format];
  const t = getTemplate(input.templateKey);
  const scale = W / 1080;

  // ── Layer 1: scene, cover-fit to canvas (centre crop) ──
  const scene = await sharp(input.scene).resize(W, H, { fit: 'cover', position: 'attention' }).removeAlpha().png().toBuffer();

  // ── Static background decorations (shades, bottom panel, frame) ──
  const panelY = Math.round(t.panel.y * H);
  const deco = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    ${t.shade.map((s) => shadeSvg(W, H, s.from, s.to, s.dir)).join('')}
    <rect x="0" y="${panelY}" width="${W}" height="${H - panelY}" fill="${COLORS.navy}" fill-opacity="0.94"/>
    <rect x="0" y="${panelY}" width="${W}" height="${Math.max(3, Math.round(5 * scale))}" fill="${COLORS.gold}"/>
    ${Array.from({ length: Math.max(0, input.contacts.length - 1) }, (_, i) => { const n = input.contacts.length; const pad = t.contacts.padX * W; const g = t.contacts.gap * W; const cw = (W - 2 * pad - g * (n - 1)) / n; const xx = Math.round(pad + (i + 1) * cw + i * g + g / 2); return `<rect x="${xx - 1}" y="${Math.round((t.contacts.y + 0.015) * H)}" width="2" height="${Math.round((t.contacts.h - 0.03) * H)}" fill="${COLORS.gold}" fill-opacity="0.6"/>`; }).join('')}
    ${t.frame ? `<rect x="${Math.round(22 * scale)}" y="${Math.round(22 * scale)}" width="${W - Math.round(44 * scale)}" height="${H - Math.round(44 * scale)}" fill="none" stroke="${COLORS.gold}" stroke-width="${Math.round(4 * scale)}" rx="${Math.round(18 * scale)}"/>` : ''}
  </svg>`;
  const background = await sharp(scene).composite([{ input: Buffer.from(deco) }]).png().toBuffer();

  const layers: PlacedLayer[] = [];

  // ── Layer 2: headline ──
  const hb = px(t.headline, W, H);
  const head = await renderText({ text: input.headline, lang: input.lang, weight: 'extrabold', color: COLORS.white, maxSize: Math.round(t.headline.maxSize * scale), minSize: Math.round(t.headline.minSize * scale), boxW: hb.w, boxH: hb.h, maxLines: t.headline.maxLines });
  layers.push({ id: 'headline', text: input.headline, png: await clip(head.png, hb.w, hb.h), ...center(head, hb), box: hb, fits: head.fits, missing: head.missing, fontSize: head.fontSize, color: COLORS.white });

  // ── Layer 3: supporting copy (optional) ──
  if (input.supportingCopy?.trim()) {
    const sb = px(t.support, W, H);
    const sup = await renderText({ text: input.supportingCopy.trim(), lang: input.lang, weight: 'bold', color: COLORS.goldLight, maxSize: Math.round(t.support.maxSize * scale), minSize: Math.round(t.support.minSize * scale), boxW: sb.w, boxH: sb.h, maxLines: t.support.maxLines });
    layers.push({ id: 'support', text: input.supportingCopy.trim(), png: await clip(sup.png, sb.w, sb.h), ...center(sup, sb), box: sb, fits: sup.fits, missing: sup.missing, fontSize: sup.fontSize, color: COLORS.goldLight });
  }

  // ── Layer 4: ORIGINAL logo — proportional resize only, no recolouring ──
  const lb = px(t.logo, W, H);
  const logoPng = await sharp(input.logo).resize(lb.w, lb.h, { fit: 'inside', kernel: 'lanczos3', withoutEnlargement: false }).png().toBuffer();
  const lm = await sharp(logoPng).metadata();
  layers.push({ id: 'logo', png: logoPng, left: lb.x + Math.round((lb.w - lm.width!) / 2), top: lb.y + Math.round((lb.h - lm.height!) / 2), width: lm.width!, height: lm.height!, box: lb, fits: true, missing: [] });

  // ── Layer 7: CTA pill ──
  const cb = px(t.cta, W, H);
  const pill = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cb.w}" height="${cb.h}"><rect width="${cb.w}" height="${cb.h}" rx="${Math.round(cb.h / 2)}" fill="${COLORS.gold}"/></svg>`);
  const ctaText = await renderText({ text: input.cta, lang: input.lang, weight: 'extrabold', color: COLORS.navy, maxSize: Math.round(t.cta.maxSize * scale), minSize: Math.round(t.cta.minSize * scale), boxW: Math.round(cb.w * 0.86), boxH: Math.round(cb.h * 0.96), maxLines: 1 });
  const ctaInner = center(ctaText, { x: 0, y: 0, w: cb.w, h: cb.h });
  const ctaPng = await sharp(pill).composite([{ input: await clip(ctaText.png, Math.round(cb.w * 0.86), Math.round(cb.h * 0.96)), left: ctaInner.left, top: ctaInner.top }]).png().toBuffer();
  layers.push({ id: 'cta', text: input.cta, png: ctaPng, left: cb.x, top: cb.y, width: cb.w, height: cb.h, box: cb, fits: ctaText.fits, missing: ctaText.missing, fontSize: ctaText.fontSize, color: COLORS.navy });

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
    const label = await renderText({ text: c.label, lang: input.lang, weight: 'bold', color: COLORS.gold, maxSize: Math.round(36 * scale), minSize: Math.round(24 * scale), boxW: labelBox.w, boxH: labelBox.h, maxLines: 1 });
    // Phone digits are always Latin digits rendered with the Cairo font, isolated as LTR
    const phone = await renderText({ text: c.phone, lang: input.lang === 'ml' ? 'en' : input.lang, weight: 'extrabold', color: COLORS.white, maxSize: Math.round(60 * scale), minSize: Math.round(34 * scale), boxW: phoneBox.w, boxH: phoneBox.h, maxLines: 1, ltr: true });
    // Stack label + gap + number, vertically centred in the card
    const gapPx = Math.round(14 * scale);
    const stackH = Math.min(label.height, labelBox.h) + gapPx + Math.min(phone.height, phoneBox.h);
    const top0 = cy + Math.max(0, Math.round((ch - stackH) / 2));
    const lp = center(label, labelBox); lp.top = top0;
    const pp = center(phone, phoneBox); pp.top = top0 + Math.min(label.height, labelBox.h) + gapPx;
    layers.push({ id: `contact:${c.key}:label`, text: c.label, png: await clip(label.png, labelBox.w, labelBox.h), ...lp, box: labelBox, fits: label.fits, missing: label.missing, fontSize: label.fontSize, color: COLORS.gold });
    layers.push({ id: `contact:${c.key}:phone`, text: c.phone, png: await clip(phone.png, phoneBox.w, phoneBox.h), ...pp, box: phoneBox, fits: phone.fits, missing: phone.missing, fontSize: phone.fontSize, color: COLORS.white });
  }

  const png = await sharp(background).composite(layers.map((l) => ({ input: l.png, left: l.left, top: l.top }))).png().toBuffer();

  const manifest: LayerManifest = {
    width: W, height: H, templateKey: t.key, lang: input.lang,
    layers: layers.map((l) => ({ id: l.id, text: l.text, rect: { left: l.left, top: l.top, width: l.width, height: l.height }, box: l.box, fits: l.fits, missing: l.missing, fontSize: l.fontSize, color: l.color })),
  };
  return { width: W, height: H, templateKey: t.key, background, layers, png, manifest };
}

/** Instagram's publishing API accepts JPEG for still images; export a high-quality JPEG. */
export const toJpeg = (png: Buffer) => sharp(png).flatten({ background: COLORS.navy }).jpeg({ quality: 92, chromaSubsampling: '4:4:4', mozjpeg: true }).toBuffer();
