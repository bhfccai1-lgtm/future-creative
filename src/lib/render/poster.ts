import sharp from 'sharp';
import { FORMAT_SIZE } from './templates';
import { renderText, type RenderedText } from './text';
import type { Lang } from './fonts';
import type { ComposeInput, ComposeResult, LayerManifest, PlacedLayer } from './compose';

/**
 * "Gold poster" layout (1080×1920) — premium Gulf advertising style:
 * logo · kicker line · product keyword inside a gold badge · tagline · large hero product window ·
 * curved navy panel with gold swoosh · benefit icons · gold CTA with cart · branch pills + phone icons.
 * Every element is a deterministic vector/text layer; the AI only provides the photo.
 */
export const POSTER_KEY = 'gold-poster';
const W = 1080, H = 1920;
const NAVY = '#0b1730', NAVY2 = '#14295c', WHITE = '#ffffff';
const PANEL_Y = 1300; // curve apex ~1240

const goldGrad = (id: string) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fdeeb0"/><stop offset="0.45" stop-color="#e6c25a"/><stop offset="1" stop-color="#b8892a"/></linearGradient>`;
const goldLine = (id: string) => `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#b8892a" stop-opacity="0"/><stop offset="0.2" stop-color="#f6d77a"/><stop offset="0.5" stop-color="#fff1b8"/><stop offset="0.8" stop-color="#f6d77a"/><stop offset="1" stop-color="#b8892a" stop-opacity="0"/></linearGradient>`;

// ── stroke icons (viewBox 0 0 100 100) ──
export const ICONS: Record<string, string> = {
  design: '<rect x="16" y="20" width="62" height="50" rx="6"/><path d="M24 62 L40 44 L52 56 L60 48 L72 62"/><circle cx="60" cy="34" r="5"/><path d="M60 86 L86 60 L92 66 L66 92 Z"/>',
  quality: '<circle cx="50" cy="40" r="24"/><path d="M38 40 L47 49 L63 33"/><path d="M36 60 L28 88 L44 80 L50 92 L56 80 L72 88 L64 60"/>',
  occasion: '<rect x="16" y="24" width="68" height="60" rx="8"/><path d="M16 40 H84 M34 14 V30 M66 14 V30"/><path d="M50 49 L55 59 L66 60 L58 68 L60 79 L50 73 L40 79 L42 68 L34 60 L45 59 Z"/>',
  gift: '<rect x="20" y="44" width="60" height="42" rx="4"/><rect x="14" y="30" width="72" height="15" rx="3"/><path d="M50 30 V86"/><path d="M50 30 C40 12 20 16 30 30 M50 30 C60 12 80 16 70 30"/>',
};
const ICON_ORDER = ['design', 'quality', 'occasion', 'gift'];
const CART = '<path d="M6 16 H20 L31 62 H78 L90 28 H26" fill="none"/><circle cx="38" cy="80" r="8"/><circle cx="72" cy="80" r="8"/>';
const PIN = '<path d="M50 92 C50 92 18 58 18 37 A32 32 0 0 1 82 37 C82 58 50 92 50 92 Z"/><circle cx="50" cy="37" r="12" fill="#fdeeb0"/>';
const PHONE = '<path d="M28 10 C22 10 14 16 16 28 C22 62 46 86 78 92 C88 94 94 86 94 80 L94 68 L72 60 L62 72 C48 66 38 56 32 42 L44 32 L36 10 Z"/>';

async function svgPng(svg: string) { return sharp(Buffer.from(svg)).png().toBuffer(); }

async function enhanceScene(scene: Buffer) {
  return sharp(scene).resize(W, H, { fit: 'cover', position: 'attention' }).removeAlpha()
    .modulate({ brightness: 1.04, saturation: 1.12 }).linear(1.06, -6).sharpen({ sigma: 0.8 }).png().toBuffer();
}

/** Scene + static vector decoration (top shade, swooshes, curved panel, dividers). Shared by stills and reel scenes. */
export async function buildPosterBackground(sceneBuf: Buffer, features: number): Promise<Buffer> {
  const scene = await enhanceScene(sceneBuf);
  const n = Math.max(1, features);
  const colW = (W - 80) / n;
  const dividers = Array.from({ length: n - 1 }, (_, i) => `<rect x="${Math.round(40 + (i + 1) * colW) - 1}" y="1395" width="2" height="120" fill="url(#gl)" opacity="0.7"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs>
      <linearGradient id="top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${NAVY}" stop-opacity="0.86"/><stop offset="0.6" stop-color="${NAVY}" stop-opacity="0.62"/><stop offset="1" stop-color="${NAVY}" stop-opacity="0"/></linearGradient>
      <linearGradient id="panel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${NAVY2}"/><stop offset="1" stop-color="${NAVY}"/></linearGradient>
      ${goldGrad('gg')}${goldLine('gl')}
      <linearGradient id="sw" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1b8"/><stop offset="0.5" stop-color="#e2bd52"/><stop offset="1" stop-color="#9c7420" stop-opacity="0.2"/></linearGradient>
    </defs>
    <rect x="0" y="0" width="${W}" height="700" fill="url(#top)"/>
    <path d="M-40 330 C 90 190 230 70 470 -30" fill="none" stroke="url(#sw)" stroke-width="12" stroke-linecap="round"/>
    <path d="M-40 380 C 120 230 270 110 540 -30" fill="none" stroke="url(#sw)" stroke-width="3" stroke-linecap="round" opacity="0.7"/>
    <path d="M1120 260 C 1000 150 900 70 760 -30" fill="none" stroke="url(#sw)" stroke-width="6" stroke-linecap="round" opacity="0.65"/>
    <rect x="${W / 2 - 200}" y="648" width="400" height="4" rx="2" fill="url(#gl)"/>
    <path d="M0 ${PANEL_Y + 40} Q ${W / 2} ${PANEL_Y - 90} ${W} ${PANEL_Y + 40} L ${W} ${H} L 0 ${H} Z" fill="url(#panel)" fill-opacity="0.97"/>
    <path d="M0 ${PANEL_Y + 40} Q ${W / 2} ${PANEL_Y - 90} ${W} ${PANEL_Y + 40}" fill="none" stroke="url(#gg)" stroke-width="9"/>
    <path d="M0 ${PANEL_Y + 62} Q ${W / 2} ${PANEL_Y - 66} ${W} ${PANEL_Y + 62}" fill="none" stroke="url(#gg)" stroke-width="2" opacity="0.6"/>
    ${dividers}
    <path d="M-30 1640 C 60 1600 120 1560 150 1500" fill="none" stroke="url(#sw)" stroke-width="5" opacity="0.6"/>
    <path d="M1110 1640 C 1020 1600 960 1560 930 1500" fill="none" stroke="url(#sw)" stroke-width="5" opacity="0.6"/>
    <rect x="${W / 2 - 1}" y="1725" width="2" height="165" fill="url(#gl)" opacity="0.8"/>
    <rect x="0" y="${H - 10}" width="${W}" height="10" fill="url(#gg)"/>
  </svg>`;
  return sharp(scene).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
}

const sparkles = (cx: number, cy: number, halfW: number) => {
  const l = (x1: number, y1: number, x2: number, y2: number) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#f2cf5b" stroke-width="9" stroke-linecap="round"/>`;
  const L = cx - halfW - 18, R = cx + halfW + 18;
  return [l(L, cy - 44, L - 36, cy - 70), l(L - 4, cy, L - 56, cy), l(L, cy + 44, L - 36, cy + 70), l(R, cy - 44, R + 36, cy - 70), l(R + 4, cy, R + 56, cy), l(R, cy + 44, R + 36, cy + 70)].join('');
};

function place(id: PlacedLayer['id'], png: Buffer, left: number, top: number, w: number, h: number, box: PlacedLayer['box'], r: Pick<RenderedText, 'fits' | 'missing' | 'fontSize'> | null, text?: string, color?: string, solid?: boolean): PlacedLayer & { solid?: boolean } {
  return { id, png, left: Math.round(left), top: Math.round(top), width: Math.round(w), height: Math.round(h), box, fits: r?.fits ?? true, missing: r?.missing ?? [], fontSize: r?.fontSize, text, color, solid };
}

export async function composePoster(input: ComposeInput & { badge?: string | null; features?: string[] }): Promise<ComposeResult> {
  const lang: Lang = input.lang;
  const features = (input.features ?? []).slice(0, 4);
  const background = await buildPosterBackground(input.scene, features.length);
  const layers: (PlacedLayer & { solid?: boolean })[] = [];

  // logo (original, proportional)
  const lb = { x: 290, y: 36, w: 500, h: 215 };
  const logoPng = await sharp(input.logo).resize(lb.w, lb.h, { fit: 'inside', kernel: 'lanczos3' }).png().toBuffer();
  const lm = await sharp(logoPng).metadata();
  layers.push(place('logo', logoPng, lb.x + (lb.w - lm.width!) / 2, lb.y + (lb.h - lm.height!) / 2, lm.width!, lm.height!, lb, null));

  // kicker line
  const kb = { x: 60, y: 262, w: 960, h: 96 };
  const k = await renderText({ text: input.headline, lang, weight: 'extrabold', color: WHITE, maxSize: 74, minSize: 44, boxW: kb.w, boxH: kb.h, maxLines: 1 });
  layers.push(place('headline', k.png, kb.x + (kb.w - k.width) / 2, kb.y + (kb.h - k.height) / 2, k.width, k.height, kb, k, input.headline, WHITE));

  // gold badge with the product keyword
  const badgeText = (input.badge ?? '').trim();
  if (badgeText) {
    const t = await renderText({ text: badgeText, lang, weight: 'extrabold', color: NAVY, maxSize: 136, minSize: 78, boxW: 720, boxH: 140, maxLines: 1 });
    const pw = Math.min(860, Math.max(440, t.width + 150)), ph = 176, py = 370;
    const cw = pw + 180, ch = ph + 12, x0 = 90; // sparkles live in the side margins of this canvas
    const pill = `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}"><defs>${goldGrad('g')}<linearGradient id="hi" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
      <rect x="${x0 + 6}" y="8" width="${pw}" height="${ph}" rx="${ph / 2}" fill="#000" opacity="0.28"/>
      <rect x="${x0}" y="2" width="${pw}" height="${ph}" rx="${ph / 2}" fill="url(#g)" stroke="#8a6417" stroke-width="4"/>
      <rect x="${x0 + 14}" y="12" width="${pw - 28}" height="${ph * 0.42}" rx="${ph * 0.21}" fill="url(#hi)"/>
      <rect x="${x0 + 10}" y="12" width="${pw - 20}" height="${ph - 20}" rx="${(ph - 20) / 2}" fill="none" stroke="#fff3c4" stroke-width="2" opacity="0.7"/>
      ${sparkles(cw / 2, 2 + ph / 2, pw / 2)}</svg>`;
    const base = await svgPng(pill);
    const png = await sharp(base).composite([{ input: t.png, left: Math.round((cw - t.width) / 2), top: Math.round(2 + (ph - t.height) / 2) }]).png().toBuffer();
    layers.push(place('badge' as PlacedLayer['id'], png, (W - cw) / 2, py, cw, ch, { x: Math.round((W - cw) / 2), y: py, w: cw, h: ch }, t, badgeText, NAVY, true));
  }

  // tagline
  if (input.supportingCopy?.trim()) {
    const sb = { x: 70, y: 562, w: 940, h: 78 };
    const sp = await renderText({ text: input.supportingCopy.trim(), lang, weight: 'bold', color: WHITE, maxSize: 60, minSize: 36, boxW: sb.w, boxH: sb.h, maxLines: 1 });
    layers.push(place('support', sp.png, sb.x + (sb.w - sp.width) / 2, sb.y + (sb.h - sp.height) / 2, sp.width, sp.height, sb, sp, input.supportingCopy.trim(), WHITE));
  }

  // benefit icons row
  if (features.length) {
    const n = features.length, colW = (W - 80) / n;
    const order = lang === 'ar' ? features.map((_, i) => n - 1 - i) : features.map((_, i) => i);
    for (let slot = 0; slot < n; slot++) {
      const i = order[slot];
      const cx = 40 + colW * slot + colW / 2;
      const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><circle cx="64" cy="64" r="58" fill="${NAVY}" fill-opacity="0.65" stroke="url(#g)" stroke-width="5"/><defs>${goldGrad('g')}</defs><g transform="translate(32 32) scale(0.64)" fill="none" stroke="#f2cf5b" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">${ICONS[ICON_ORDER[i % ICON_ORDER.length]]}</g></svg>`;
      const icon = await svgPng(iconSvg);
      const lbl = await renderText({ text: features[i], lang, weight: 'bold', color: WHITE, maxSize: 32, minSize: 22, boxW: Math.round(colW - 20), boxH: 84, maxLines: 2 });
      const cw = Math.round(colW - 10), ch = 128 + 10 + lbl.height;
      const png = await sharp({ create: { width: cw, height: ch, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: icon, left: Math.round((cw - 128) / 2), top: 0 }, { input: lbl.png, left: Math.round((cw - lbl.width) / 2), top: 138 }]).png().toBuffer();
      layers.push(place(`benefit:${i}` as PlacedLayer['id'], png, cx - cw / 2, 1370, cw, ch, { x: Math.round(cx - cw / 2), y: 1370, w: cw, h: 230 }, { ...lbl, fits: lbl.fits && ch <= 230 }, features[i], WHITE));
    }
  }

  // CTA — gold pill with cart icon
  {
    const cw = 660, chh = 124, cy = 1595;
    const t = await renderText({ text: input.cta, lang, weight: 'extrabold', color: NAVY, maxSize: 70, minSize: 30, boxW: cw - 200, boxH: 100, maxLines: 1 });
    const cart = `<g transform="translate(${lang === 'ar' ? 56 : cw - 136} 22) scale(0.8)" fill="none" stroke="${NAVY}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round">${CART}</g>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${chh}"><defs>${goldGrad('g')}</defs><rect x="2" y="2" width="${cw - 4}" height="${chh - 4}" rx="${(chh - 4) / 2}" fill="url(#g)" stroke="#8a6417" stroke-width="4"/><rect x="14" y="10" width="${cw - 28}" height="${chh * 0.38}" rx="${chh * 0.19}" fill="#fff" opacity="0.28"/>${cart}</svg>`;
    const base = await svgPng(svg);
    const tx = lang === 'ar' ? Math.round(160 + (cw - 200 - t.width) / 2) : Math.round(40 + (cw - 200 - t.width) / 2);
    const png = await sharp(base).composite([{ input: t.png, left: Math.max(10, tx), top: Math.round((chh - t.height) / 2) }]).png().toBuffer();
    layers.push(place('cta', png, (W - cw) / 2, cy, cw, chh, { x: (W - cw) / 2, y: cy, w: cw, h: chh }, t, input.cta, NAVY, true));
  }

  // branches: gold pill label with pin + phone icon and number
  const order = lang === 'ar' ? [...input.contacts].reverse() : input.contacts;
  const colW2 = W / Math.max(1, order.length);
  for (let i = 0; i < order.length; i++) {
    const c = order[i];
    const cx = colW2 * i + colW2 / 2;
    const lt = await renderText({ text: c.label, lang, weight: 'extrabold', color: NAVY, maxSize: 42, minSize: 28, boxW: 300, boxH: 60, maxLines: 1 });
    const pw = Math.min(colW2 - 60, lt.width + 120), ph = 76;
    const pinX = lang === 'ar' ? pw - 70 : 18;
    const pillSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pw}" height="${ph}"><defs>${goldGrad('g')}</defs><rect x="2" y="2" width="${pw - 4}" height="${ph - 4}" rx="${(ph - 4) / 2}" fill="url(#g)" stroke="#8a6417" stroke-width="3"/><g transform="translate(${pinX} 10) scale(0.56)" fill="${NAVY}">${PIN}</g></svg>`;
    const lpng = await sharp(await svgPng(pillSvg)).composite([{ input: lt.png, left: Math.round(lang === 'ar' ? (pw - 70 - lt.width) / 2 + 6 : 70 + (pw - 70 - lt.width) / 2 - 6), top: Math.round((ph - lt.height) / 2) }]).png().toBuffer();
    layers.push(place(`contact:${c.key}:label` as PlacedLayer['id'], lpng, cx - pw / 2, 1730, pw, ph, { x: Math.round(cx - pw / 2), y: 1730, w: pw, h: ph }, lt, c.label, NAVY, true));

    const nt = await renderText({ text: c.phone, lang: lang === 'ml' ? 'en' : lang, weight: 'extrabold', color: WHITE, maxSize: 84, minSize: 50, boxW: 360, boxH: 96, maxLines: 1, ltr: true });
    const iconD = 80, gap = 18, rw = Math.round(iconD + gap + nt.width), rh = Math.max(iconD, nt.height);
    const phoneIcon = await svgPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${iconD}" height="${iconD}"><defs>${goldGrad('g')}</defs><circle cx="${iconD / 2}" cy="${iconD / 2}" r="${iconD / 2 - 2}" fill="url(#g)"/><g transform="translate(18 18) scale(0.44)" fill="${NAVY}">${PHONE}</g></svg>`);
    const ppng = await sharp({ create: { width: rw, height: rh, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: phoneIcon, left: 0, top: Math.round((rh - iconD) / 2) }, { input: nt.png, left: iconD + gap, top: Math.round((rh - nt.height) / 2) }]).png().toBuffer();
    layers.push(place(`contact:${c.key}:phone` as PlacedLayer['id'], ppng, cx - rw / 2, 1818, rw, rh, { x: Math.round(cx - colW2 / 2 + 20), y: 1818, w: Math.round(colW2 - 40), h: 96 }, { ...nt, fits: nt.fits && rw <= colW2 - 30 }, c.phone, WHITE));
  }

  const png = await sharp(background).composite(layers.map((l) => ({ input: l.png, left: l.left, top: l.top }))).png().toBuffer();
  const manifest: LayerManifest = {
    width: W, height: H, templateKey: POSTER_KEY, lang,
    layers: layers.map((l) => ({ id: l.id, text: l.text, rect: { left: l.left, top: l.top, width: l.width, height: l.height }, box: l.box, fits: l.fits, missing: l.missing, fontSize: l.fontSize, color: l.color, solid: l.solid })),
  };
  return { width: W, height: H, templateKey: POSTER_KEY, themeKey: 'navy_gold', background, layers, png, manifest };
}

export const AI_POSTER_KEY = 'ai-poster';
/**
 * Full-AI poster geometry per output height — full-bleed like a hand-made agency poster: the AI design fills the
 * whole frame (story 2:3 → 9:16 trims ~8 % per side, feed 1:1 → 4:5 trims ~12 % per side, square exact; the prompt
 * keeps all drawn text inside the safe central width). The model leaves the top zone empty for the ORIGINAL logo and
 * the bottom zone as plain background, where the system overlays the gold order button and the glass phone panel.
 */
export function aiPosterGeometry(h: number) {
  // topBand: the logo's own zone (a soft extension of the art) — the AI design starts BELOW it, so the logo can never cover drawn text
  if (h === 1920) return { H: 1920, topBand: 290, topPct: 4, bottomPct: 22, safeWidthPct: 86, logo: { w: 440, h: 230, y: 30 }, cta: { w: 600, h: 104, y: 1574 }, panel: { y: 1700, h: 186 } };
  if (h === 1350) return { H: 1350, topBand: 220, topPct: 4, bottomPct: 26, safeWidthPct: 90, logo: { w: 380, h: 180, y: 20 }, cta: { w: 540, h: 90, y: 1058 }, panel: { y: 1162, h: 168 } };
  return { H: h, topBand: 150, topPct: 9, bottomPct: 30, safeWidthPct: 92, logo: { w: 260, h: 120, y: 18 }, cta: { w: 500, h: 82, y: h - 276 }, panel: { y: h - 180, h: 164 } };
}
/** The image size to request from the model for a full-AI poster of this format height. */
export const aiPosterImageSize = (h: number): '1024x1536' | '1024x1024' => (h === 1920 ? '1024x1536' : '1024x1024');

/** Gold ribbon swooshes rising from both bottom corners (behind the panel), like the reference posters. */
const ribbons = (H: number) => {
  const side = (m: 1 | -1) => { const x = (v: number) => (m === 1 ? v : W - v);
    return `<path d="M${x(-30)} ${H - 330} C ${x(60)} ${H - 250} ${x(40)} ${H - 120} ${x(190)} ${H - 30} C ${x(110)} ${H - 60} ${x(-10)} ${H - 170} ${x(-30)} ${H - 250} Z" fill="url(#rg)" opacity="0.95"/>
    <path d="M${x(-30)} ${H - 200} C ${x(90)} ${H - 120} ${x(220)} ${H - 40} ${x(420)} ${H + 10}" fill="none" stroke="url(#rg)" stroke-width="10" opacity="0.9"/>`; };
  return `${side(1)}${side(-1)}<path d="M-20 ${H - 8} C 300 ${H - 46} 760 ${H + 14} ${W + 20} ${H - 30}" fill="none" stroke="url(#gl)" stroke-width="6"/>`;
};

/** Background for the full-AI poster: the AI design full-bleed + soft legibility gradient + glass phone panel + ribbons. */
export async function buildAiPosterBackground(poster: Buffer, height = 1920): Promise<Buffer> {
  const g = aiPosterGeometry(height), H = g.H, artH = H - g.topBand;
  // never crop the design when the aspect differs a lot (square output from a 1:1 image): fit it whole on a blurred fill
  const crop = Math.abs(W / artH - 1) > 0.1 && Math.abs(W / artH - 2 / 3) > 0.05;
  const soft = (w: number, h: number, blur: number, b: number) => sharp(poster).resize(w, h, { fit: 'fill' }).blur(blur).modulate({ brightness: b }).removeAlpha().png().toBuffer();
  let art: Buffer;
  if (!crop) art = await sharp(poster).resize(W, artH, { fit: 'cover', position: 'centre' }).removeAlpha().sharpen({ sigma: 0.5 }).png().toBuffer();
  else {
    const side = Math.min(W, artH);
    const main = await sharp(poster).resize(side, side, { fit: 'cover' }).removeAlpha().sharpen({ sigma: 0.5 }).png().toBuffer();
    art = await sharp(await soft(W, artH, 34, 0.7)).composite([{ input: main, left: Math.round((W - side) / 2), top: Math.round((artH - side) / 2) }]).png().toBuffer();
  }
  // logo band: the whole design's colours, heavily blurred and deepened (no ghost of drawn text) — one continuous image
  const edge = await soft(W, g.topBand + 60, 48, 0.55);
  const feather = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${artH}"><defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="${(36 / artH).toFixed(4)}" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><rect width="${W}" height="${artH}" fill="url(#f)"/></svg>`);
  const artFeathered = await sharp(art).ensureAlpha().composite([{ input: feather, blend: 'dest-in' }]).png().toBuffer();
  const base = await sharp({ create: { width: W, height: H, channels: 3, background: NAVY } })
    .composite([{ input: edge, left: 0, top: 0 }, { input: artFeathered, left: 0, top: g.topBand }]).png().toBuffer();
  const zone = g.cta.y - 60, px = 70, pw = W - 2 * px;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs>${goldGrad('gg')}${goldLine('gl')}
      <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${NAVY}" stop-opacity="0"/><stop offset="0.45" stop-color="${NAVY}" stop-opacity="0.55"/><stop offset="1" stop-color="${NAVY}" stop-opacity="0.92"/></linearGradient>
      <linearGradient id="glass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${NAVY2}" stop-opacity="0.94"/><stop offset="1" stop-color="${NAVY}" stop-opacity="0.96"/></linearGradient>
      <linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1b8"/><stop offset="0.5" stop-color="#e6c25a"/><stop offset="1" stop-color="#9c6f1c"/></linearGradient>
      <radialGradient id="lg" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${NAVY}" stop-opacity="0.35"/><stop offset="1" stop-color="${NAVY}" stop-opacity="0"/></radialGradient></defs>
    <ellipse cx="${W / 2}" cy="${g.logo.y + g.logo.h / 2}" rx="${g.logo.w * 0.75}" ry="${g.logo.h * 0.8}" fill="url(#lg)"/>
    <rect x="0" y="${zone}" width="${W}" height="${H - zone}" fill="url(#fade)"/>
    ${ribbons(H)}
    <rect x="${px}" y="${g.panel.y}" width="${pw}" height="${g.panel.h}" rx="40" fill="url(#glass)" stroke="url(#gg)" stroke-width="4"/>
    <rect x="${px + 24}" y="${g.panel.y + 6}" width="${pw - 48}" height="2" fill="#ffffff" opacity="0.18"/>
    <rect x="${W / 2 - 1}" y="${g.panel.y + 26}" width="2" height="${g.panel.h - 52}" fill="url(#gg)" opacity="0.7"/>
  </svg>`;
  return sharp(base).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
}

/**
 * Full-AI poster: the image model drew the whole design; the system adds only what must be exact —
 * the ORIGINAL logo (top reserved zone), the order button and the verified branch phone numbers (glass panel).
 */
export async function composeAiPoster(input: ComposeInput): Promise<ComposeResult> {
  const lang = input.lang;
  const g = aiPosterGeometry(FORMAT_SIZE[input.format].h), H = g.H;
  const background = await buildAiPosterBackground(input.scene, H);
  const layers: (PlacedLayer & { solid?: boolean })[] = [];

  // the original logo, large, in the empty top zone
  const lb = { x: Math.round((W - g.logo.w) / 2), y: g.logo.y, w: g.logo.w, h: g.logo.h };
  const logoPng = await sharp(input.logo).resize(lb.w, lb.h, { fit: 'inside', kernel: 'lanczos3' }).png().toBuffer();
  const lm = await sharp(logoPng).metadata();
  layers.push(place('logo', logoPng, lb.x + (lb.w - lm.width!) / 2, lb.y + (lb.h - lm.height!) / 2, lm.width!, lm.height!, lb, null));

  // glossy gold order button with a cart and sparkle rays
  const cw = g.cta.w, chh = g.cta.h, cy = g.cta.y, rays = 70, tw = cw + 2 * rays;
  const t = await renderText({ text: input.cta, lang, weight: 'extrabold', color: NAVY, maxSize: Math.round(chh * 0.6), minSize: 28, boxW: cw - 170, boxH: chh - 20, maxLines: 1 });
  const cs = chh / 96;
  const cart = `<g transform="translate(${rays + (lang === 'ar' ? 50 * cs : cw - 120 * cs)} ${16 * cs}) scale(${0.66 * cs})" fill="none" stroke="${NAVY}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round">${CART}</g>`;
  const ray = (x: number, dir: number) => [-22, 0, 22].map((dy) => `<line x1="${x}" y1="${chh / 2 + dy * 0.9}" x2="${x + dir * (dy === 0 ? 44 : 34)}" y2="${chh / 2 + dy * 1.7}" stroke="#f6d77a" stroke-width="5" stroke-linecap="round"/>`).join('');
  const csvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tw}" height="${chh}"><defs>${goldGrad('g')}</defs>${ray(rays - 14, -1)}${ray(rays + cw + 14, 1)}
    <rect x="${rays + 2}" y="2" width="${cw - 4}" height="${chh - 4}" rx="${(chh - 4) / 2}" fill="url(#g)" stroke="#fff1b8" stroke-width="4"/>
    <rect x="${rays + 2}" y="2" width="${cw - 4}" height="${chh - 4}" rx="${(chh - 4) / 2}" fill="none" stroke="#8a6417" stroke-width="2" opacity="0.7"/>
    <rect x="${rays + 16}" y="8" width="${cw - 32}" height="${chh * 0.36}" rx="${chh * 0.18}" fill="#fff" opacity="0.32"/>${cart}</svg>`;
  const tx = rays + (lang === 'ar' ? Math.round(135 * cs + (cw - 170 * cs - t.width) / 2) : Math.round(35 * cs + (cw - 170 * cs - t.width) / 2));
  const cpng = await sharp(await svgPng(csvg)).composite([{ input: t.png, left: Math.max(rays + 10, tx), top: Math.round((chh - t.height) / 2) }]).png().toBuffer();
  layers.push(place('cta', cpng, (W - tw) / 2, cy, tw, chh, { x: (W - tw) / 2, y: cy, w: tw, h: chh }, t, input.cta, NAVY, true));

  // branches inside the glass panel: gold branch name, then the number in a gold pill
  const order = lang === 'ar' ? [...input.contacts].reverse() : input.contacts;
  const inner = W - 140, col = inner / Math.max(1, order.length);
  const labelH = Math.round(g.panel.h * 0.3), pillH = Math.round(g.panel.h * 0.44);
  const labelY = g.panel.y + Math.round(g.panel.h * 0.08), pillY = g.panel.y + g.panel.h - pillH - Math.round(g.panel.h * 0.1);
  for (let i = 0; i < order.length; i++) {
    const c = order[i]; const cx = 70 + col * i + col / 2;
    const lt = await renderText({ text: c.label, lang, weight: 'extrabold', color: '#f6d77a', maxSize: Math.round(labelH * 0.78), minSize: 24, boxW: Math.round(col - 60), boxH: labelH, maxLines: 1 });
    layers.push(place(`contact:${c.key}:label` as PlacedLayer['id'], lt.png, cx - lt.width / 2, labelY + (labelH - lt.height) / 2, lt.width, lt.height, { x: Math.round(cx - col / 2 + 30), y: labelY, w: Math.round(col - 60), h: labelH }, lt, c.label, '#f6d77a'));
    const nt = await renderText({ text: c.phone, lang: lang === 'ml' ? 'en' : lang, weight: 'extrabold', color: NAVY, maxSize: Math.round(pillH * 0.72), minSize: 36, boxW: Math.round(col - 150), boxH: pillH - 8, maxLines: 1, ltr: true });
    const iconD = Math.round(pillH * 0.62), pw = Math.min(Math.round(col - 30), nt.width + iconD + 70);
    const psvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pw}" height="${pillH}"><defs>${goldGrad('g')}</defs><rect x="2" y="2" width="${pw - 4}" height="${pillH - 4}" rx="${(pillH - 4) / 2}" fill="url(#g)" stroke="#fff1b8" stroke-width="3"/>
      <rect x="12" y="6" width="${pw - 24}" height="${pillH * 0.34}" rx="${pillH * 0.17}" fill="#fff" opacity="0.28"/>
      <g transform="translate(24 ${(pillH - iconD) / 2}) scale(${iconD / 100})" fill="${NAVY}">${PHONE}</g></svg>`;
    const ppng = await sharp(await svgPng(psvg)).composite([{ input: nt.png, left: Math.round(24 + iconD + (pw - 24 - iconD - nt.width) / 2 - 6), top: Math.round((pillH - nt.height) / 2) }]).png().toBuffer();
    layers.push(place(`contact:${c.key}:phone` as PlacedLayer['id'], ppng, cx - pw / 2, pillY, pw, pillH, { x: Math.round(cx - col / 2 + 15), y: pillY, w: Math.round(col - 30), h: pillH }, { ...nt, fits: nt.fits && pw <= col - 20 }, c.phone, NAVY, true));
  }

  const png = await sharp(background).composite(layers.map((l) => ({ input: l.png, left: l.left, top: l.top }))).png().toBuffer();
  const manifest: LayerManifest = {
    width: W, height: H, templateKey: AI_POSTER_KEY, lang,
    layers: layers.map((l) => ({ id: l.id, text: l.text, rect: { left: l.left, top: l.top, width: l.width, height: l.height }, box: l.box, fits: l.fits, missing: l.missing, fontSize: l.fontSize, color: l.color, solid: l.solid })),
  };
  return { width: W, height: H, templateKey: AI_POSTER_KEY, themeKey: 'navy_gold', background, layers, png, manifest };
}
