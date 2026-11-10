import sharp from 'sharp';
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
const AI_H = 1620; // 1024×1536 (2:3) → 1080×1620, no cropping of AI-drawn text
const BAND = H - AI_H; // 300 px verified band

/** Background for the full-AI poster: the AI design untouched on top + verified navy band below + soft logo backdrop. */
export async function buildAiPosterBackground(poster: Buffer): Promise<Buffer> {
  const art = await sharp(poster).resize(W, AI_H, { fit: 'cover', position: 'centre' }).removeAlpha().sharpen({ sigma: 0.5 }).png().toBuffer();
  const band = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs>
      <linearGradient id="pb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${NAVY2}"/><stop offset="1" stop-color="${NAVY}"/></linearGradient>${goldGrad('gg')}${goldLine('gl')}
      <radialGradient id="lg" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${NAVY}" stop-opacity="0.45"/><stop offset="1" stop-color="${NAVY}" stop-opacity="0"/></radialGradient></defs>
    <ellipse cx="${W / 2}" cy="120" rx="360" ry="150" fill="url(#lg)"/>
    <path d="M0 ${AI_H + 26} Q ${W / 2} ${AI_H - 30} ${W} ${AI_H + 26} L ${W} ${H} L 0 ${H} Z" fill="url(#pb)"/>
    <path d="M0 ${AI_H + 26} Q ${W / 2} ${AI_H - 30} ${W} ${AI_H + 26}" fill="none" stroke="url(#gg)" stroke-width="8"/>
    <rect x="${W / 2 - 1}" y="${AI_H + 130}" width="2" height="150" fill="url(#gl)" opacity="0.8"/>
    <rect x="0" y="${H - 10}" width="${W}" height="10" fill="url(#gg)"/>
  </svg>`;
  return sharp({ create: { width: W, height: H, channels: 3, background: NAVY } })
    .composite([{ input: art, left: 0, top: 0 }, { input: Buffer.from(band) }]).png().toBuffer();
}

/**
 * Full-AI poster: the image model drew the whole design; the system adds only what must be exact —
 * the ORIGINAL logo (top reserved zone), the CTA and the verified branch phone numbers (bottom band).
 */
export async function composeAiPoster(input: ComposeInput): Promise<ComposeResult> {
  const lang = input.lang;
  const background = await buildAiPosterBackground(input.scene);
  const layers: (PlacedLayer & { solid?: boolean })[] = [];

  const lb = { x: 300, y: 22, w: 480, h: 190 };
  const logoPng = await sharp(input.logo).resize(lb.w, lb.h, { fit: 'inside', kernel: 'lanczos3' }).png().toBuffer();
  const lm = await sharp(logoPng).metadata();
  layers.push(place('logo', logoPng, lb.x + (lb.w - lm.width!) / 2, lb.y + (lb.h - lm.height!) / 2, lm.width!, lm.height!, lb, null));

  // CTA
  const cw = 620, chh = 96, cy = AI_H + 34;
  const t = await renderText({ text: input.cta, lang, weight: 'extrabold', color: NAVY, maxSize: 58, minSize: 28, boxW: cw - 170, boxH: 80, maxLines: 1 });
  const cart = `<g transform="translate(${lang === 'ar' ? 46 : cw - 116} 16) scale(0.66)" fill="none" stroke="${NAVY}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round">${CART}</g>`;
  const csvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${chh}"><defs>${goldGrad('g')}</defs><rect x="2" y="2" width="${cw - 4}" height="${chh - 4}" rx="${(chh - 4) / 2}" fill="url(#g)" stroke="#8a6417" stroke-width="4"/><rect x="14" y="8" width="${cw - 28}" height="${chh * 0.36}" rx="${chh * 0.18}" fill="#fff" opacity="0.28"/>${cart}</svg>`;
  const tx = lang === 'ar' ? Math.round(135 + (cw - 170 - t.width) / 2) : Math.round(35 + (cw - 170 - t.width) / 2);
  const cpng = await sharp(await svgPng(csvg)).composite([{ input: t.png, left: Math.max(10, tx), top: Math.round((chh - t.height) / 2) }]).png().toBuffer();
  layers.push(place('cta', cpng, (W - cw) / 2, cy, cw, chh, { x: (W - cw) / 2, y: cy, w: cw, h: chh }, t, input.cta, NAVY, true));

  // branches
  const order = lang === 'ar' ? [...input.contacts].reverse() : input.contacts;
  const col = W / Math.max(1, order.length);
  for (let i = 0; i < order.length; i++) {
    const c = order[i]; const cx = col * i + col / 2;
    const lt = await renderText({ text: c.label, lang, weight: 'extrabold', color: NAVY, maxSize: 34, minSize: 24, boxW: 260, boxH: 48, maxLines: 1 });
    const pw = Math.min(col - 80, lt.width + 100), ph = 58;
    const pinX = lang === 'ar' ? pw - 56 : 14;
    const psvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pw}" height="${ph}"><defs>${goldGrad('g')}</defs><rect x="2" y="2" width="${pw - 4}" height="${ph - 4}" rx="${(ph - 4) / 2}" fill="url(#g)" stroke="#8a6417" stroke-width="3"/><g transform="translate(${pinX} 8) scale(0.44)" fill="${NAVY}">${PIN}</g></svg>`;
    const lpng = await sharp(await svgPng(psvg)).composite([{ input: lt.png, left: Math.round(lang === 'ar' ? (pw - 56 - lt.width) / 2 + 4 : 56 + (pw - 56 - lt.width) / 2 - 4), top: Math.round((ph - lt.height) / 2) }]).png().toBuffer();
    layers.push(place(`contact:${c.key}:label` as PlacedLayer['id'], lpng, cx - pw / 2, AI_H + 142, pw, ph, { x: Math.round(cx - pw / 2), y: AI_H + 142, w: pw, h: ph }, lt, c.label, NAVY, true));
    const nt = await renderText({ text: c.phone, lang: lang === 'ml' ? 'en' : lang, weight: 'extrabold', color: WHITE, maxSize: 70, minSize: 44, boxW: 320, boxH: 80, maxLines: 1, ltr: true });
    const iconD = 66, gap = 14, rw = Math.round(iconD + gap + nt.width), rh = Math.max(iconD, nt.height);
    const icon = await svgPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${iconD}" height="${iconD}"><defs>${goldGrad('g')}</defs><circle cx="${iconD / 2}" cy="${iconD / 2}" r="${iconD / 2 - 2}" fill="url(#g)"/><g transform="translate(15 15) scale(0.36)" fill="${NAVY}">${PHONE}</g></svg>`);
    const ppng = await sharp({ create: { width: rw, height: rh, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: icon, left: 0, top: Math.round((rh - iconD) / 2) }, { input: nt.png, left: iconD + gap, top: Math.round((rh - nt.height) / 2) }]).png().toBuffer();
    layers.push(place(`contact:${c.key}:phone` as PlacedLayer['id'], ppng, cx - rw / 2, AI_H + 210, rw, rh, { x: Math.round(cx - col / 2 + 20), y: AI_H + 210, w: Math.round(col - 40), h: 80 }, { ...nt, fits: nt.fits && rw <= col - 30 }, c.phone, WHITE));
  }
  void BAND;

  const png = await sharp(background).composite(layers.map((l) => ({ input: l.png, left: l.left, top: l.top }))).png().toBuffer();
  const manifest: LayerManifest = {
    width: W, height: H, templateKey: AI_POSTER_KEY, lang,
    layers: layers.map((l) => ({ id: l.id, text: l.text, rect: { left: l.left, top: l.top, width: l.width, height: l.height }, box: l.box, fits: l.fits, missing: l.missing, fontSize: l.fontSize, color: l.color, solid: l.solid })),
  };
  return { width: W, height: H, templateKey: AI_POSTER_KEY, themeKey: 'navy_gold', background, layers, png, manifest };
}
