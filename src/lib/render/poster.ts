import sharp, { type OverlayOptions } from 'sharp';
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
// Reference-style layout (premium Gulf print ad): big logo · huge GOLD product title · white promise line · gold arc ·
// benefit icons row · large product window · gold «اطلب الآن» with a tapping hand · branch names + WhatsApp number
// pills · gold footer ribbon with the Bahrain pin. Logo, order button and numbers stay inside the Instagram safe zone
// (IG_SAFE_1920: 236–1540); the footer ribbon is decoration below it.
const L = { logo: { x: 290, y: 236, w: 500, h: 168 }, title: 414, sub: 544, sep: 616, feat: 636, cta: 1258, label: 1374, phone: 1430, footer: 1748, colX: 110 };
const PANEL_Y = L.cta - 90; // where the bottom shade becomes solid enough for the order block
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
const PHONE = '<path d="M28 10 C22 10 14 16 16 28 C22 62 46 86 78 92 C88 94 94 86 94 80 L94 68 L72 60 L62 72 C48 66 38 56 32 42 L44 32 L36 10 Z"/>';

async function svgPng(svg: string) { return sharp(Buffer.from(svg)).png().toBuffer(); }

async function enhanceScene(scene: Buffer) {
  return sharp(scene).resize(W, H, { fit: 'cover', position: 'attention' }).removeAlpha()
    .modulate({ brightness: 1.04, saturation: 1.12 }).linear(1.06, -6).sharpen({ sigma: 0.8 }).png().toBuffer();
}

/** Scene + static vector decoration (shades, gold corner bands, product glow). Shared by stills and reel scenes. */
export async function buildPosterBackground(sceneBuf: Buffer, features: number): Promise<Buffer> {
  const p = await buildPosterParts(sceneBuf, features);
  return sharp(p.art).composite([{ input: p.chrome }]).png().toBuffer();
}
export async function buildPosterParts(sceneBuf: Buffer, features: number): Promise<{ art: Buffer; chrome: Buffer }> {
  const scene = await enhanceScene(sceneBuf);
  void features;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs>
      <linearGradient id="top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${NAVY}" stop-opacity="0.92"/><stop offset="0.87" stop-color="${NAVY}" stop-opacity="0.84"/><stop offset="0.94" stop-color="${NAVY}" stop-opacity="0.45"/><stop offset="1" stop-color="${NAVY}" stop-opacity="0"/></linearGradient>
      <linearGradient id="bot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${NAVY}" stop-opacity="0"/><stop offset="0.11" stop-color="${NAVY}" stop-opacity="0.7"/><stop offset="0.26" stop-color="${NAVY}" stop-opacity="0.9"/><stop offset="1" stop-color="${NAVY}" stop-opacity="0.97"/></linearGradient>
      <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ffe9a8" stop-opacity="0.32"/><stop offset="1" stop-color="#ffe9a8" stop-opacity="0"/></radialGradient>
      ${goldGrad('gg')}${goldLine('gl')}
      <linearGradient id="band" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1b8"/><stop offset="0.45" stop-color="#e2bd52"/><stop offset="1" stop-color="#8a6417"/></linearGradient>
    </defs>
    <ellipse cx="${W / 2}" cy="${(L.feat + 110 + PANEL_Y) / 2 + 40}" rx="460" ry="330" fill="url(#glow)"/>
    <rect x="0" y="0" width="${W}" height="${L.feat + 200}" fill="url(#top)"/>
    <rect x="0" y="${PANEL_Y - 20}" width="${W}" height="${H - PANEL_Y + 20}" fill="url(#bot)"/>
    <path d="M0 250 C 120 150 250 70 420 0 L 380 0 C 230 60 110 130 0 210 Z" fill="url(#band)"/>
    <path d="M0 300 C 150 180 290 90 480 0" fill="none" stroke="url(#band)" stroke-width="3" opacity="0.8"/>
    <path d="M${W} 250 C ${W - 120} 150 ${W - 250} 70 ${W - 420} 0 L ${W - 380} 0 C ${W - 230} 60 ${W - 110} 130 ${W} 210 Z" fill="url(#band)" opacity="0.9"/>
    <path d="M0 ${H - 230} C 160 ${H - 150} 300 ${H - 70} 420 ${H} L 360 ${H} C 250 ${H - 60} 130 ${H - 130} 0 ${H - 190} Z" fill="url(#band)" opacity="0.9"/>
    <path d="M${W} ${H - 230} C ${W - 160} ${H - 150} ${W - 300} ${H - 70} ${W - 420} ${H} L ${W - 360} ${H} C ${W - 250} ${H - 60} ${W - 130} ${H - 130} ${W} ${H - 190} Z" fill="url(#band)" opacity="0.9"/>
    <path d="M${W / 2 - 330} ${L.sep + 10} Q ${W / 2} ${L.sep - 18} ${W / 2 + 330} ${L.sep + 10}" fill="none" stroke="url(#gl)" stroke-width="4" stroke-linecap="round"/>
    <rect x="${W / 2 - 1}" y="${L.label + 4}" width="2" height="132" fill="url(#gl)" opacity="0.75"/>
  </svg>`;
  return { art: scene, chrome: await sharp(Buffer.from(svg)).png().toBuffer() };
}

function place(id: PlacedLayer['id'], png: Buffer, left: number, top: number, w: number, h: number, box: PlacedLayer['box'], r: Pick<RenderedText, 'fits' | 'missing' | 'fontSize'> | null, text?: string, color?: string, solid?: boolean): PlacedLayer & { solid?: boolean } {
  return { id, png, left: Math.round(left), top: Math.round(top), width: Math.round(w), height: Math.round(h), box, fits: r?.fits ?? true, missing: r?.missing ?? [], fontSize: r?.fontSize, text, color, solid };
}

/** white text → gold-gradient text with a soft dark shadow (premium headline look) */
async function goldText(t: RenderedText, shadow: RenderedText): Promise<{ png: Buffer; w: number; h: number }> {
  const pad = 14, w = t.width + pad * 2, h = t.height + pad * 2;
  const grad = await svgPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${t.width}" height="${t.height}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff4c2"/><stop offset="0.38" stop-color="#f3d36b"/><stop offset="0.7" stop-color="#d9a93a"/><stop offset="1" stop-color="#a87a22"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`);
  const gold = await sharp(grad).composite([{ input: t.png, blend: 'dest-in' }]).png().toBuffer();
  const sh = await sharp(shadow.png).blur(5).png().toBuffer();
  const png = await sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: sh, left: pad + 3, top: pad + 5 }, { input: gold, left: pad, top: pad }]).png().toBuffer();
  return { png, w, h };
}

const HAND = '<path d="M40 34 V64 M40 34 C40 25 53 25 53 34 V54 M53 42 C53 34 65 34 65 42 V56 M65 48 C65 40 77 40 77 48 V68 C77 84 67 95 53 95 H49 C39 95 32 88 27 80 L19 64 C15 56 25 50 31 57 L40 67"/><path d="M40 4 V16 M18 14 L27 23 M62 14 L53 23 M12 34 H24"/>';
const WA = '<path d="M50 6 A44 44 0 0 0 12 72 L6 94 L29 88 A44 44 0 1 0 50 6 Z" fill="none" stroke-width="7"/><path d="M36 28 C32 28 28 33 29 39 C32 55 45 68 61 71 C67 72 72 68 72 64 L72 58 L61 54 L56 60 C49 57 43 51 40 44 L46 39 L42 28 Z"/>';
const BH_PIN = '<defs><clipPath id="pc"><path d="M50 96 C50 96 14 60 14 38 A36 36 0 0 1 86 38 C86 60 50 96 50 96 Z"/></clipPath></defs><g clip-path="url(#pc)"><rect x="0" y="0" width="100" height="100" fill="#ce1126"/><path d="M0 0 H38 L48 8 L38 16 L48 24 L38 32 L48 40 L38 48 L48 56 L38 64 L48 72 L38 80 L48 88 L38 96 H0 Z" fill="#fff"/></g><path d="M50 96 C50 96 14 60 14 38 A36 36 0 0 1 86 38 C86 60 50 96 50 96 Z" fill="none" stroke="#fff" stroke-width="5"/>';

export async function composePoster(input: ComposeInput & { badge?: string | null; features?: string[]; footer?: string | null }): Promise<ComposeResult> {
  const lang: Lang = input.lang;
  const parts = await buildPosterParts(input.scene, 0);
  const background = await sharp(parts.art).composite([{ input: parts.chrome }]).png().toBuffer();
  const layers: (PlacedLayer & { solid?: boolean })[] = [];

  // logo — big, no frame (the brand leads, as in a printed flyer)
  const lb = { ...L.logo };
  const logoPng = await sharp(input.logo).resize(lb.w, lb.h, { fit: 'inside', kernel: 'lanczos3' }).png().toBuffer();
  const lm = await sharp(logoPng).metadata();
  layers.push(place('logo', logoPng, lb.x + (lb.w - lm.width!) / 2, lb.y + (lb.h - lm.height!) / 2, lm.width!, lm.height!, lb, null));

  // the product keyword as a huge gold title (falls back to the headline when there is no badge)
  const badgeText = (input.badge ?? '').trim();
  const titleText = badgeText || input.headline;
  {
    const tb = { x: 60, y: L.title, w: 960, h: 124 };
    const spec = { text: titleText, lang, weight: 'extrabold' as const, maxSize: 124, minSize: 64, boxW: tb.w - 30, boxH: tb.h - 24, maxLines: 1 };
    const t = await renderText({ ...spec, color: WHITE });
    const sh = await renderText({ ...spec, color: '#02070f' });
    const g = await goldText(t, sh);
    layers.push(place((badgeText ? 'badge' : 'headline') as PlacedLayer['id'], g.png, (W - g.w) / 2, tb.y + (tb.h - g.h) / 2, g.w, g.h, tb, t, titleText, '#f0cc62'));
  }

  // white promise line (the headline when the title is the badge, else the supporting copy)
  const subText = (badgeText ? input.headline : input.supportingCopy ?? '').trim();
  if (subText) {
    const sb = { x: 70, y: L.sub, w: 940, h: 66 };
    const sp = await renderText({ text: subText, lang, weight: 'bold', color: WHITE, maxSize: 56, minSize: 34, boxW: sb.w, boxH: sb.h, maxLines: 1 });
    layers.push(place(badgeText ? 'headline' : 'support', sp.png, sb.x + (sb.w - sp.width) / 2, sb.y + (sb.h - sp.height) / 2, sp.width, sp.height, sb, sp, subText, WHITE));
  }

  // benefit row: gold stroke icons + labels with thin gold dividers (or the supporting line when no benefits are set)
  const feats = (input.features ?? []).map((f) => f.trim()).filter(Boolean).slice(0, 4);
  if (feats.length >= 2) {
    const n = feats.length, x0 = 70, rowW = W - 2 * x0, colW = rowW / n, iconD = 58;
    const cols = lang === 'ar' ? feats.map((f, i) => ({ f, i })).reverse() : feats.map((f, i) => ({ f, i }));
    const row = sharp({ create: { width: rowW, height: 112, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
    const parts: OverlayOptions[] = [];
    let allFit = true; const miss: string[] = [];
    for (const [k, c] of cols.entries()) {
      const icon = await svgPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${iconD}" height="${iconD}" viewBox="0 0 100 100"><defs>${goldGrad('g')}</defs><g fill="none" stroke="url(#g)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">${ICONS[ICON_ORDER[c.i % ICON_ORDER.length]]}</g></svg>`);
      const lt = await renderText({ text: c.f, lang, weight: 'bold', color: WHITE, maxSize: 32, minSize: 22, boxW: Math.round(colW - 24), boxH: 42, maxLines: 1 });
      allFit &&= lt.fits; miss.push(...lt.missing);
      const cx = colW * k + colW / 2;
      parts.push({ input: icon, left: Math.round(cx - iconD / 2), top: 0 }, { input: lt.png, left: Math.round(cx - lt.width / 2), top: iconD + 10 + Math.round((42 - lt.height) / 2) });
      if (k > 0) parts.push({ input: await svgPng(`<svg xmlns="http://www.w3.org/2000/svg" width="3" height="96"><rect width="2" height="96" fill="#e6c25a" opacity="0.7"/></svg>`), left: Math.round(colW * k), top: 8 });
    }
    const png = await row.composite(parts).png().toBuffer();
    layers.push(place('support', png, x0, L.feat, rowW, 112, { x: x0, y: L.feat, w: rowW, h: 112 }, { fits: allFit, missing: miss, fontSize: 32 }, feats.join(' · '), WHITE));
  } else if (badgeText && input.supportingCopy?.trim()) {
    const sb = { x: 80, y: L.feat + 10, w: 920, h: 58 };
    const sp = await renderText({ text: input.supportingCopy.trim(), lang, weight: 'regular', color: '#f6e7b8', maxSize: 44, minSize: 30, boxW: sb.w, boxH: sb.h, maxLines: 1 });
    layers.push(place('support', sp.png, sb.x + (sb.w - sp.width) / 2, sb.y + (sb.h - sp.height) / 2, sp.width, sp.height, sb, sp, input.supportingCopy.trim(), '#f6e7b8'));
  }

  // CTA — gold pill with a tapping hand
  {
    const cw = 580, chh = 104, cy = L.cta;
    const t = await renderText({ text: input.cta, lang, weight: 'extrabold', color: NAVY, maxSize: 66, minSize: 30, boxW: cw - 190, boxH: 90, maxLines: 1 });
    const hand = `<g transform="translate(${lang === 'ar' ? cw - 128 : 40} 8) scale(0.88)" fill="none" stroke="${NAVY}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">${HAND}</g>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${chh}"><defs>${goldGrad('g')}<linearGradient id="hi" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><rect x="2" y="2" width="${cw - 4}" height="${chh - 4}" rx="${(chh - 4) / 2}" fill="url(#g)" stroke="#8a6417" stroke-width="4"/><rect x="18" y="8" width="${cw - 36}" height="${chh * 0.38}" rx="${chh * 0.19}" fill="url(#hi)"/>${hand}</svg>`;
    const base = await svgPng(svg);
    const tx = lang === 'ar' ? Math.round(40 + (cw - 190 - t.width) / 2) : Math.round(150 + (cw - 190 - t.width) / 2);
    const png = await sharp(base).composite([{ input: t.png, left: Math.max(10, tx), top: Math.round((chh - t.height) / 2) }]).png().toBuffer();
    layers.push(place('cta', png, (W - cw) / 2, cy, cw, chh, { x: (W - cw) / 2, y: cy, w: cw, h: chh }, t, input.cta, NAVY, true));
  }

  // branches: name in white, number inside a navy pill with a gold outline and a WhatsApp icon
  const order = lang === 'ar' ? [...input.contacts].reverse() : input.contacts;
  const colW2 = (W - 2 * L.colX) / Math.max(1, order.length);
  for (let i = 0; i < order.length; i++) {
    const c = order[i];
    const cx = L.colX + colW2 * i + colW2 / 2;
    const lt = await renderText({ text: c.label, lang, weight: 'bold', color: WHITE, maxSize: 44, minSize: 28, boxW: Math.round(colW2 - 60), boxH: 52, maxLines: 1 });
    layers.push(place(`contact:${c.key}:label` as PlacedLayer['id'], lt.png, cx - lt.width / 2, L.label, lt.width, lt.height, { x: Math.round(cx - colW2 / 2 + 20), y: L.label, w: Math.round(colW2 - 40), h: 52 }, lt, c.label, WHITE));

    const nt = await renderText({ text: c.phone, lang: lang === 'ml' || lang === 'hi' ? 'en' : lang, weight: 'extrabold', color: WHITE, maxSize: 60, minSize: 38, boxW: Math.round(colW2 - 160), boxH: 66, maxLines: 1, ltr: true });
    const pw = Math.round(Math.min(colW2 - 30, nt.width + 140)), ph = 86, iconD = 58;
    const iconX = lang === 'ar' ? 22 : pw - iconD - 22;
    const pill = await svgPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${pw}" height="${ph}"><defs>${goldGrad('g')}</defs><rect x="3" y="3" width="${pw - 6}" height="${ph - 6}" rx="${(ph - 6) / 2}" fill="#081226" fill-opacity="0.92" stroke="url(#g)" stroke-width="5"/><g transform="translate(${iconX} ${(ph - iconD) / 2}) scale(${iconD / 100})" fill="url(#g)" stroke="url(#g)">${WA}</g></svg>`);
    const tx = lang === 'ar' ? iconX + iconD + Math.round((pw - iconD - 44 - nt.width) / 2) : Math.round((pw - iconD - 44 - nt.width) / 2) + 22;
    const ppng = await sharp(pill).composite([{ input: nt.png, left: Math.max(8, tx), top: Math.round((ph - nt.height) / 2) }]).png().toBuffer();
    layers.push(place(`contact:${c.key}:phone` as PlacedLayer['id'], ppng, cx - pw / 2, L.phone, pw, ph, { x: Math.round(cx - colW2 / 2 + 10), y: L.phone, w: Math.round(colW2 - 20), h: ph }, { ...nt, fits: nt.fits && pw <= colW2 - 20 }, c.phone, WHITE, true));
  }

  // footer ribbon: the shop name + Bahrain pin (decoration under Instagram's reply bar)
  if (input.footer?.trim()) {
    const fw = 760, fh = 78;
    const ft = await renderText({ text: input.footer.trim(), lang, weight: 'bold', color: NAVY, maxSize: 38, minSize: 24, boxW: fw - 170, boxH: 56, maxLines: 1 });
    const pinX = lang === 'ar' ? fw - 112 : 52;
    const rib = await svgPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${fw}" height="${fh}"><defs>${goldGrad('g')}</defs><path d="M24 2 H${fw - 2} L${fw - 24} ${fh - 2} H2 Z" fill="url(#g)" stroke="#8a6417" stroke-width="3"/><g transform="translate(${pinX} 6) scale(0.66)">${BH_PIN}</g></svg>`);
    const tx = lang === 'ar' ? Math.round(40 + (fw - 170 - ft.width) / 2) : Math.round(130 + (fw - 170 - ft.width) / 2);
    const fpng = await sharp(rib).composite([{ input: ft.png, left: Math.max(10, tx), top: Math.round((fh - ft.height) / 2) }]).png().toBuffer();
    layers.push(place('support' as PlacedLayer['id'], fpng, (W - fw) / 2, L.footer, fw, fh, { x: (W - fw) / 2, y: L.footer, w: fw, h: fh }, ft, input.footer.trim(), NAVY, true));
    layers[layers.length - 1].id = 'footer' as PlacedLayer['id'];
  }

  const png = await sharp(background).composite(layers.map((l) => ({ input: l.png, left: l.left, top: l.top }))).png().toBuffer();
  const manifest: LayerManifest = {
    width: W, height: H, templateKey: POSTER_KEY, lang,
    layers: layers.map((l) => ({ id: l.id, text: l.text, rect: { left: l.left, top: l.top, width: l.width, height: l.height }, box: l.box, fits: l.fits, missing: l.missing, fontSize: l.fontSize, color: l.color, solid: l.solid })),
  };
  return { width: W, height: H, templateKey: POSTER_KEY, themeKey: 'navy_gold', background, art: parts.art, chrome: parts.chrome, layers, png, manifest };
}

export const AI_POSTER_KEY = 'ai-poster';
/**
 * Full-AI poster geometry per output height — full-bleed like a hand-made agency poster: the AI design fills the
 * whole frame (story 2:3 → 9:16 trims ~8 % per side, feed 1:1 → 4:5 trims ~12 % per side, square exact; the prompt
 * keeps all drawn text inside the safe central width). The model leaves the top zone empty for the ORIGINAL logo and
 * the bottom zone as plain background, where the system overlays the gold order button and the glass phone panel.
 */
export type FeatureStrip = { y: number; h: number; x: number; w: number };
export function aiPosterGeometry(h: number, featureRow = true, logoBottom = false) {
  // the brand features: ONE framed bar under the product, right above the order button — two features side by side
  // with a gold divider (owner's sketch, every format). The design's bottom zone grows to include the bar, so the
  // product always ends above it.
  const g = geometryCore(h, false, logoBottom);
  if (!featureRow) return { ...g, strip: null as FeatureStrip | null };
  const sh = g.H === 1920 ? 96 : g.H === 1350 ? 84 : 72, mx = g.H === 1920 ? 90 : 60;
  const strip: FeatureStrip = { x: mx, w: W - 2 * mx, h: sh, y: g.cta.y - (g.H === 1080 ? 16 : 24) - sh };
  const artH = g.H - g.topBand;
  const bottomPct = Math.max(g.bottomPct, Math.ceil(((g.H - (strip.y - 12)) / artH) * 100));
  return { ...g, bottomPct, strip: strip as FeatureStrip | null };
}
function geometryCore(h: number, featureRow = true, logoBottom = false) {
  const b = aiPosterGeometryBase(h);
  // no system feature row → nothing reserved for it: the design gets that space (feed: bottom zone 40 % → 26 %)
  const g = featureRow || !b.features ? b : { ...b, features: null, bottomPct: h === 1350 ? 26 : b.bottomPct };
  if (!logoBottom) return g;
  // logo in the footer, between the two branches (owner's sketch): the design fills the top; the logo box sits centred,
  // rising a little above the glass panel
  // as tall as fits between the order button and the panel's bottom edge (never touching the button)
  // a compact square emblem (on a light plate, see buildAiPosterBackground) so the two branches keep wide phone pills
  if (h === 1920) {
    // owner's reel sketch: ONE wide contact bar (navy + gold), branch name + big digits straight on the bar, a large logo
    // centred and rising above the bar's top edge, «اطلب الآن» above it all. Bottom edge 1534 < IG_SAFE_1920.bottom.
    const bar = { y: 1378, h: 156 }, cta = { w: 540, h: 90, y: 1196 };
    const lgH = 200, lgW = 230; // the logo keeps its height; a narrower box leaves the digits more width
    return { ...g, panel: bar, cta, bar: true, topBand: 0, topPct: 13, bottomPct: 42, logo: { w: lgW, h: lgH, y: bar.y + bar.h - lgH - 8 } };
  }
  const panel = g.panel;
  const lh = Math.min(170, panel.y + panel.h - (g.cta.y + g.cta.h) - 10), lw = lh;
  // stories/reels: with no logo band the design starts at the top edge, so the text must start below Instagram's own
  // account bar and progress line (IG_SAFE_1920.top = 236 px ≈ 13 %) — at 3 % the headline sat under them
  // bottomPct is a share of the ART: with no logo band the art is the full 1920 px, so 42 % keeps the product above
  // y ≈ 1114 (the order button starts at 1222) and gives the hero more room than 48 % would
  return { ...g, panel, topBand: 0, topPct: h === 1350 ? 10 : h === 1920 ? 13 : g.topPct, bottomPct: h === 1920 ? 42 : g.bottomPct, logo: { w: lw, h: lh, y: panel.y + panel.h - lh - 14 } };
}
function aiPosterGeometryBase(h: number) {
  // topBand: the logo's own zone (a soft extension of the art) — the AI design starts BELOW it, so the logo can never cover drawn text
  // Stories / Reels: everything Instagram must not cover sits inside IG_SAFE_1920 (logo below the account bar, order
  // button + phones above the caption/reply area, panel clear of the Reels side icons, all inside the 3:4 grid crop).
  // The AI art still fills the whole frame; below y≈1540 it is plain background under Instagram's own UI.
  // full frame (owner): no blurred logo band — the design starts at the top edge, the logo sits ON it at y=244 (below
  // Instagram's account bar), the headline starts under the logo (21 %), the product ends above the order button (38 %)
  if (h === 1920) return { bar: false, H: 1920, topBand: 0, topPct: 21, bottomPct: 38, features: null as { y: number; icon: number; label: number } | null, safeWidthPct: 78, padX: 120, logo: { w: 380, h: 150, y: 244 }, cta: { w: 580, h: 100, y: 1222 }, panel: { y: 1350, h: 176 } };
  if (h === 1350) return { bar: false, H: 1350, topBand: 150, topPct: 3, bottomPct: 40, features: { y: 922, icon: 76, label: 26 } as { y: number; icon: number; label: number } | null, safeWidthPct: 90, padX: 70, logo: { w: 320, h: 130, y: 16 }, cta: { w: 540, h: 90, y: 1058 }, panel: { y: 1162, h: 168 } };
  return { bar: false, H: h, topBand: 118, topPct: 4, bottomPct: 36, features: null as { y: number; icon: number; label: number } | null, safeWidthPct: 92, padX: 70, logo: { w: 230, h: 100, y: 16 }, cta: { w: 500, h: 82, y: h - 276 }, panel: { y: h - 180, h: 164 } };
}
/** HYBRID: share of the art height the text-free design keeps calm for the system's headline, badge and tagline. */
export const headlinePct = (h: number) => (h === 1920 ? 18 : h === 1350 ? 22 : 24);
/** The headline area in output pixels (inside the art, under the top margin). */
export function headlineZone(h: number, featureRow = true, logoBottom = false) {
  const g = aiPosterGeometry(h, featureRow, logoBottom), artH = g.H - g.topBand;
  return { x: 60, y: g.topBand + Math.round((artH * g.topPct) / 100) + 6, w: W - 120, h: Math.round((artH * headlinePct(g.H)) / 100) };
}
const relLum = (c: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a: number[], b: number[]) => { const [x, y] = [relLum(a), relLum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const NAVY_RGB = [0x0b, 0x17, 0x30], GOLD_TXT = [0xf6, 0xd7, 0x7a], WHITE_RGB = [255, 255, 255], VEIL_RGB = [0xff, 0xfa, 0xf0], DEEP_GOLD = [0x6b, 0x4a, 0x12];
/** headline text colours per tone: white + gold on dark art, navy + deep gold on light art */
export const HEADLINE_TONES = { dark: { head: WHITE, sup: '#f6d77a', shadow: '#050b18' }, light: { head: NAVY, sup: '#6b4a12', shadow: '#fffaf0' } } as const;
/**
 * the overlay opacity that gives the main text ≥ 4.5:1 and the tagline ≥ 3.5:1 over the WORST of 3 bands of an area
 * (dark tone: a navy shade under white/gold; light tone: a warm white veil under navy/deep gold)
 */
async function shadeForContrast(img: Buffer, r: { x: number; y: number; w: number; h: number }, tone: 'dark' | 'light' = 'dark'): Promise<number> {
  const over = tone === 'dark' ? NAVY_RGB : VEIL_RGB, main = tone === 'dark' ? WHITE_RGB : NAVY_RGB, sup = tone === 'dark' ? GOLD_TXT : DEEP_GOLD;
  let need = 0;
  for (let k = 0; k < 3; k++) {
    const top = r.y + Math.floor((r.h * k) / 3), h = Math.max(2, Math.floor(r.h / 3));
    const band = await sharp(img).extract({ left: r.x, top, width: r.w, height: h }).removeAlpha().png().toBuffer();
    const st = await sharp(band).stats(), m = [st.channels[0].mean, st.channels[1].mean, st.channels[2].mean];
    let a = 0;
    for (; a < 0.94; a += 0.02) { const c = m.map((v, i) => v * (1 - a) + over[i] * a); if (ratio(main, c) >= 4.5 && ratio(sup, c) >= 3.5) break; }
    need = Math.max(need, a);
  }
  return Math.min(0.94, need);
}

/** light or dark art under the headline area → which text colours read best (mean relative luminance of the area) */
export async function headlineTone(img: Buffer, r: { x: number; y: number; w: number; h: number }): Promise<'dark' | 'light'> {
  const reg = await sharp(img).extract({ left: r.x, top: r.y, width: r.w, height: r.h }).removeAlpha().png().toBuffer();
  const st = await sharp(reg).stats();
  return relLum([st.channels[0].mean, st.channels[1].mean, st.channels[2].mean]) > 0.42 ? 'light' : 'dark';
}

/** a soft dark shadow under a text layer (any design behind it stays readable); returns the padded image and its offset */
async function withShadow(png: Buffer, pad = 14, color = '#050b18') {
  const m = await sharp(png).metadata();
  const alpha = await sharp(png).ensureAlpha().extractChannel(3).blur(5).linear(0.75, 0).toBuffer();
  const shadow = await sharp({ create: { width: m.width!, height: m.height!, channels: 3, background: color } }).joinChannel(alpha).png().toBuffer();
  const out = await sharp({ create: { width: m.width! + 2 * pad, height: m.height! + 2 * pad, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: shadow, left: pad + 2, top: pad + 4 }, { input: png, left: pad, top: pad }]).png().toBuffer();
  return { png: out, pad };
}

/** The image size to request from the model for a full-AI poster of this format height. */
export const aiPosterImageSize = (h: number, logoBottom = false): '1024x1536' | '1024x1024' =>
  (h === 1920 || (h === 1350 && logoBottom) ? '1024x1536' : '1024x1024'); // feed with the logo in the footer: no top band → a portrait design fills it

/** Gold ribbon swooshes rising from both bottom corners (behind the panel), like the reference posters. */
const ribbons = (H: number) => {
  const side = (m: 1 | -1) => { const x = (v: number) => (m === 1 ? v : W - v);
    return `<path d="M${x(-30)} ${H - 330} C ${x(60)} ${H - 250} ${x(40)} ${H - 120} ${x(190)} ${H - 30} C ${x(110)} ${H - 60} ${x(-10)} ${H - 170} ${x(-30)} ${H - 250} Z" fill="url(#rg)" opacity="0.95"/>
    <path d="M${x(-30)} ${H - 200} C ${x(90)} ${H - 120} ${x(220)} ${H - 40} ${x(420)} ${H + 10}" fill="none" stroke="url(#rg)" stroke-width="10" opacity="0.9"/>`; };
  return `${side(1)}${side(-1)}<path d="M-20 ${H - 8} C 300 ${H - 46} 760 ${H + 14} ${W + 20} ${H - 30}" fill="none" stroke="url(#gl)" stroke-width="6"/>`;
};

/** Background for the full-AI poster: the AI design full-bleed + soft legibility gradient + glass phone panel + ribbons. */
export async function buildAiPosterBackground(poster: Buffer, height = 1920, featureRow = true, logoBottom = false, headline: { y: number; h: number; tone?: 'dark' | 'light' } | null = null): Promise<Buffer> {
  const p = await buildAiPosterParts(poster, height, featureRow, logoBottom, headline);
  return sharp(p.art).composite([{ input: p.chrome }]).png().toBuffer();
}
/** the AI poster background as the moving art (design + logo band) and the fixed chrome (shades, ribbons, panel, plate) */
export async function buildAiPosterParts(poster: Buffer, height = 1920, featureRow = true, logoBottom = false, headline: { y: number; h: number; tone?: 'dark' | 'light' } | null = null): Promise<{ art: Buffer; chrome: Buffer }> {
  const g = aiPosterGeometry(height, featureRow, logoBottom), H = g.H, artH = H - g.topBand;
  // never crop the design when the aspect differs a lot (square output from a 1:1 image): fit it whole on a blurred fill
  // (a full-height 9:16 story — logo in the footer — is a normal cover crop of the 2:3 design: ~8 % per side)
  // fit the design whole on a blurred fill only when its own shape is far from the art area (e.g. a square design in a
  // tall frame); otherwise a cover crop — a blurred band at the top was the visible result of the old fixed-ratio rule
  //  • square design: cover only in a near-square/slightly tall area (feed); a wider area (square post) keeps the blurred
  //    sides so the top text is never cut
  //  • portrait 2:3 design: cover in any tall area from 9:16 to 4:5 (stories, and the feed with the logo in the footer)
  const im = await sharp(poster).metadata();
  const ia = im.width! / im.height!, r = W / artH;
  const crop = ia >= 0.95 ? r > 1.05 || r < 0.85 : r < 0.5 || r > 0.85;
  const soft = (w: number, h: number, blur: number, b: number) => sharp(poster).resize(w, h, { fit: 'fill' }).blur(blur).modulate({ brightness: b }).removeAlpha().png().toBuffer();
  let art: Buffer;
  if (!crop) art = await sharp(poster).resize(W, artH, { fit: 'cover', position: 'centre' }).removeAlpha().sharpen({ sigma: 0.5 }).png().toBuffer();
  else {
    const side = Math.min(W, artH);
    const main = await sharp(poster).resize(side, side, { fit: 'cover' }).removeAlpha().sharpen({ sigma: 0.5 }).png().toBuffer();
    // the side margins continue the art: deepened only on dark art (0.7 made light designs grey at the edges)
    const lum = (await sharp(poster).greyscale().stats()).channels[0].mean;
    art = await sharp(await soft(W, artH, 34, lum > 150 ? 0.98 : 0.7)).composite([{ input: main, left: Math.round((W - side) / 2), top: Math.round((artH - side) / 2) }]).png().toBuffer();
  }
  // logo band: the whole design's colours, heavily blurred and deepened (no ghost of drawn text) — one continuous image
  // built from the TOP strip of the design (not the whole design squashed), so it continues the art above it and the
  // bright product never shows through as a blurred ghost — visible once the logo sits in a corner
  const pm = await sharp(poster).metadata();
  const strip = await sharp(poster).extract({ left: 0, top: 0, width: pm.width!, height: Math.max(8, Math.round(pm.height! * 0.14)) }).png().toBuffer();
  // the logo band continues the top of the art: darkened only on DARK art — on a light design (cream, sky, white
  // studio) a 0.55 brightness turned it into a muddy grey strip (design audit). stats() needs extracted pixels first.
  const topLum = (await sharp(strip).greyscale().stats()).channels[0].mean;
  const lightTop = topLum > 150;
  // the band reaches past the art's 90 px feather — a shorter band let the navy base show through as a grey seam line
  const edge = await sharp(strip).resize(W, g.topBand + 110, { fit: 'fill' }).blur(48).modulate({ brightness: lightTop ? 1 : 0.55 }).removeAlpha().png().toBuffer();
  const feather = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${artH}"><defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="${(90 / artH).toFixed(4)}" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><rect width="${W}" height="${artH}" fill="url(#f)"/></svg>`);
  const artFeathered = await sharp(art).ensureAlpha().composite([{ input: feather, blend: 'dest-in' }]).png().toBuffer();
  const base = await sharp({ create: { width: W, height: H, channels: 3, background: NAVY } })
    // no logo band (logo in the footer): the design itself starts at the top edge — no blend, no dark seam
    .composite(g.topBand === 0 ? [{ input: art, left: 0, top: 0 }] : [{ input: edge, left: 0, top: 0 }, { input: artFeathered, left: 0, top: g.topBand }]).png().toBuffer();
  const zone = g.cta.y - 70, px = g.padX, pw = W - 2 * px;
  const hzC = headline?.tone === 'light' ? '#fffaf0' : NAVY;
  // the headline shade follows how busy the art is under the text: calm art → light shade, busy art → deeper shade,
  // so the typeset headline never fights the picture (measured, no AI call; stats() needs the extracted pixels first)
  let hzA = 0.5;
  if (headline) {
    const hy = Math.max(0, Math.min(H - 2, headline.y)), hh = Math.max(2, Math.min(headline.h, H - hy));
    const region = await sharp(base).extract({ left: 0, top: hy, width: W, height: hh }).greyscale().png().toBuffer();
    const sd = (await sharp(region).stats()).channels[0].stdev;
    // light art: a gentle veil is enough (dark text reads on it); dark art: the navy shade, deeper when the art is busy
    hzA = headline.tone === 'light' ? Math.max(0.15, Math.min(0.6, 0.15 + (sd - 25) / 120)) : Math.max(0.45, Math.min(0.82, 0.45 + (sd - 25) / 90));
    // CONTRAST, not taste: the shade is as dark as the BRIGHTEST band under the text needs for white ≥ 4.5:1 and gold
    // ≥ 3.5:1 (QC asks ≥ 3:1) — a light AI design (cream, white, sky) left the gold tagline at 1.2–2:1
    hzA = Math.max(hzA, await shadeForContrast(base, { x: Math.round(W * 0.08), y: hy, w: Math.round(W * 0.84), h: hh }, headline.tone ?? 'dark'));
    hzA = Math.round(hzA * 100) / 100;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs>${goldGrad('gg')}${goldLine('gl')}
      <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${NAVY}" stop-opacity="0"/><stop offset="0.45" stop-color="${NAVY}" stop-opacity="0.55"/><stop offset="1" stop-color="${NAVY}" stop-opacity="0.92"/></linearGradient>
      <linearGradient id="unfade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${NAVY}" stop-opacity="0.6"/><stop offset="0.3" stop-color="${NAVY}" stop-opacity="0.12"/><stop offset="1" stop-color="${NAVY}" stop-opacity="0"/></linearGradient>
      <linearGradient id="glass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${NAVY2}" stop-opacity="0.94"/><stop offset="1" stop-color="${NAVY}" stop-opacity="0.96"/></linearGradient>
      <linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1b8"/><stop offset="0.5" stop-color="#e6c25a"/><stop offset="1" stop-color="#9c6f1c"/></linearGradient>
      <radialGradient id="lg" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${lightTop ? '#fffaf0' : NAVY}" stop-opacity="${lightTop ? 0.5 : g.topBand === 0 && !logoBottom ? 0.55 : 0.35}"/><stop offset="1" stop-color="${lightTop ? '#fffaf0' : NAVY}" stop-opacity="0"/></radialGradient></defs>
    <ellipse cx="${W / 2}" cy="${g.logo.y + g.logo.h / 2}" rx="${g.logo.w * 0.75}" ry="${g.logo.h * 0.8}" fill="url(#lg)"/>
    ${H === 1920
      // Reels / Stories: the shade sits only behind the order button and the phones, then fades out — below them (where
      // Instagram draws its own caption and buttons) the design itself continues instead of an empty dark block
      ? `<rect x="0" y="${zone}" width="${W}" height="${g.panel.y + g.panel.h + 70 - zone}" fill="url(#fade)"/><rect x="0" y="${g.panel.y + g.panel.h + 70}" width="${W}" height="${H - (g.panel.y + g.panel.h + 70)}" fill="url(#unfade)"/>`
      : `<rect x="0" y="${zone}" width="${W}" height="${H - zone}" fill="url(#fade)"/>`}
    ${headline ? `<linearGradient id="hz" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hzC}" stop-opacity="0"/><stop offset="${(120 / (headline.h + 190)).toFixed(3)}" stop-color="${hzC}" stop-opacity="${hzA}"/><stop offset="${((headline.h + 120) / (headline.h + 190)).toFixed(3)}" stop-color="${hzC}" stop-opacity="${hzA}"/><stop offset="1" stop-color="${hzC}" stop-opacity="0"/></linearGradient><rect x="0" y="${headline.y - 120}" width="${W}" height="${headline.h + 190}" fill="url(#hz)"/>` : ''}
    ${ribbons(H)}
    ${g.strip ? `<rect x="${g.strip.x}" y="${g.strip.y}" width="${g.strip.w}" height="${g.strip.h}" rx="${Math.round(g.strip.h * 0.22)}" fill="${NAVY}" fill-opacity="0.78" stroke="#f3ead6" stroke-opacity="0.9" stroke-width="3"/><line x1="${W / 2}" y1="${g.strip.y + g.strip.h * 0.24}" x2="${W / 2}" y2="${g.strip.y + g.strip.h * 0.76}" stroke="#e2b84a" stroke-width="4" stroke-linecap="round"/>` : ''}
    <rect x="${px}" y="${g.panel.y}" width="${pw}" height="${g.panel.h}" rx="40" fill="url(#glass)" stroke="url(#gg)" stroke-width="4"/>
    <rect x="${px + 24}" y="${g.panel.y + 6}" width="${pw - 48}" height="2" fill="#ffffff" opacity="0.18"/>
    ${logoBottom && g.bar ? `<radialGradient id="halo" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff6dc" stop-opacity="0.55"/><stop offset="0.6" stop-color="#fff6dc" stop-opacity="0.18"/><stop offset="1" stop-color="#fff6dc" stop-opacity="0"/></radialGradient><ellipse cx="${W / 2}" cy="${g.logo.y + g.logo.h / 2}" rx="${g.logo.w * 0.62}" ry="${g.logo.h * 0.62}" fill="url(#halo)"/>` : logoBottom ? `<rect x="${(W - g.logo.w) / 2}" y="${g.logo.y}" width="${g.logo.w}" height="${g.logo.h}" rx="30" fill="#fffdf7" fill-opacity="0.97" stroke="url(#gg)" stroke-width="5"/>` : `<rect x="${W / 2 - 1}" y="${g.panel.y + 26}" width="2" height="${g.panel.h - 52}" fill="url(#gg)" opacity="0.7"/>`}
  </svg>`;
  return { art: base, chrome: await sharp(Buffer.from(svg)).png().toBuffer() };
}

/**
 * Full-AI poster: the image model drew the whole design; the system adds only what must be exact —
 * the ORIGINAL logo (top reserved zone), the order button and the verified branch phone numbers (glass panel).
 */
export async function composeAiPoster(input: ComposeInput): Promise<ComposeResult> {
  const lang = input.lang;
  const hasRow = ((input as ComposeInput & { features?: string[] }).features ?? []).length > 0; // the glass row is drawn only when it holds features
  const logoBottom = input.logoPosition === 'bottom-center';
  const g = aiPosterGeometry(FORMAT_SIZE[input.format].h, hasRow, logoBottom), H = g.H;
  const hz0 = input.typeset ? headlineZone(H, hasRow, logoBottom) : null;
  // the headline's tone follows the art under it: measured on the background without the shade
  const tone = hz0 ? await headlineTone(await buildAiPosterBackground(input.scene, H, hasRow, logoBottom), { x: Math.round(W * 0.08), y: hz0.y, w: Math.round(W * 0.84), h: hz0.h }) : 'dark';
  const hz = hz0 ? { ...hz0, tone } : null;
  const ink = HEADLINE_TONES[tone];
  const parts = await buildAiPosterParts(input.scene, H, hasRow, logoBottom, hz);
  const background = await sharp(parts.art).composite([{ input: parts.chrome }]).png().toBuffer();
  // inset = transparent shadow margin around a typeset layer: composited with it, but the manifest (QC overlap, contrast,
  // safe-zone checks) measures the real text box — the soft shadows of stacked lines touching is not an overlap
  const layers: (PlacedLayer & { solid?: boolean; inset?: number })[] = [];

  // HYBRID (golden rule): the headline, the gold badge and the tagline are typeset by the system — verified spelling,
  // correct Arabic shaping — in the calm area the text-free design left for them
  if (input.typeset && hz) {
    const t = input.typeset, hasBadge = !!t.badge?.trim(), hasSup = !!t.support?.trim();
    const hH = Math.round(hz.h * (hasBadge ? (hasSup ? 0.44 : 0.55) : hasSup ? 0.7 : 1)), bH = hasBadge ? Math.round(hz.h * (hasSup ? 0.34 : 0.42)) : 0, sH = hz.h - hH - bH;
    let y = hz.y;
    const head = await renderText({ text: t.headline, lang, weight: 'extrabold', color: ink.head, maxSize: Math.min(110, Math.round(hH * 0.8)), minSize: 34, boxW: hz.w, boxH: hH, maxLines: 2 });
    const hs = await withShadow(head.png, 14, ink.shadow);
    layers.push({ ...place('headline', hs.png, (W - head.width) / 2 - hs.pad, y + (hH - head.height) / 2 - hs.pad, head.width + 2 * hs.pad, head.height + 2 * hs.pad, { x: hz.x, y, w: hz.w, h: hH }, head, t.headline, ink.head), inset: hs.pad });
    y += hH;
    if (hasBadge) {
      const pillH = Math.round(bH * 0.86);
      const bt = await renderText({ text: t.badge!.trim(), lang, weight: 'extrabold', color: NAVY, maxSize: Math.round(pillH * 0.66), minSize: 30, boxW: hz.w - 140, boxH: pillH - 16, maxLines: 1 });
      const pw = Math.min(hz.w, bt.width + 110);
      const pill = `<svg xmlns="http://www.w3.org/2000/svg" width="${pw}" height="${pillH}"><defs>${goldGrad('g')}</defs><rect x="2" y="2" width="${pw - 4}" height="${pillH - 4}" rx="${(pillH - 4) / 2}" fill="url(#g)" stroke="#fff1b8" stroke-width="4"/><rect x="14" y="7" width="${pw - 28}" height="${pillH * 0.34}" rx="${pillH * 0.17}" fill="#fff" opacity="0.3"/></svg>`;
      const bpng = await sharp(await svgPng(pill)).composite([{ input: bt.png, left: Math.round((pw - bt.width) / 2), top: Math.round((pillH - bt.height) / 2) }]).png().toBuffer();
      const bs = await withShadow(bpng, 12);
      layers.push({ ...place('badge' as PlacedLayer['id'], bs.png, (W - pw) / 2 - bs.pad, y + (bH - pillH) / 2 - bs.pad, pw + 2 * bs.pad, pillH + 2 * bs.pad, { x: hz.x, y, w: hz.w, h: bH }, { ...bt, fits: bt.fits && pw <= hz.w }, t.badge!.trim(), NAVY, true), inset: bs.pad });
      y += bH;
    }
    if (hasSup) {
      const st = await renderText({ text: t.support!.trim(), lang, weight: 'bold', color: ink.sup, maxSize: Math.min(56, Math.round(sH * 0.78)), minSize: 24, boxW: hz.w, boxH: sH, maxLines: 1 });
      const ss = await withShadow(st.png, 10, ink.shadow);
      layers.push({ ...place('support', ss.png, (W - st.width) / 2 - ss.pad, y + (sH - st.height) / 2 - ss.pad, st.width + 2 * ss.pad, st.height + 2 * ss.pad, { x: hz.x, y, w: hz.w, h: sH }, st, t.support!.trim(), ink.sup), inset: ss.pad });
    }
  }

  // the ORIGINAL logo (the supplied file, only scaled) in the empty top zone, where the design needs it:
  // centred (default), in a corner (smaller, leaves the stage to the design), or centred with the centre's name under it
  const pos = input.logoPosition ?? 'auto';
  const corner = pos === 'top-right' || pos === 'top-left';
  const withName = pos === 'top-center-name' && !!input.brandName?.trim();
  const lw = corner ? Math.round(g.logo.w * 0.72) : g.logo.w;
  const lh = corner ? Math.round(g.logo.h * 0.72) : withName ? Math.round(g.logo.h * 0.66) : g.logo.h;
  const lx = pos === 'top-right' ? W - g.padX - lw : pos === 'top-left' ? g.padX : Math.round((W - lw) / 2); // centred also for bottom-center
  const lb = logoBottom && !g.bar ? { x: lx + 10, y: g.logo.y + 10, w: lw - 20, h: lh - 20 } : { x: lx, y: g.logo.y, w: lw, h: lh };
  const logoPng = await sharp(input.logo).resize(lb.w, lb.h, { fit: 'inside', kernel: 'lanczos3' }).png().toBuffer();
  const lm = await sharp(logoPng).metadata();
  const logoX = pos === 'top-right' ? lb.x + lb.w - lm.width! : pos === 'top-left' ? lb.x : lb.x + (lb.w - lm.width!) / 2;
  layers.push(place('logo', logoPng, logoX, corner ? lb.y : lb.y + (lb.h - lm.height!) / 2, lm.width!, lm.height!, lb, null));
  if (withName) {
    // the centre's name typed by the system under the logo (exact spelling), like a printed flyer header
    const name = input.brandName!.trim();
    const nameLang: Lang = /[\u0600-\u06FF]/.test(name) ? 'ar' : 'en';
    const nb = { x: Math.round(W * 0.12), y: lb.y + lh + 4, w: Math.round(W * 0.76), h: Math.max(28, g.logo.h - lh - 4) };
    const nt = await renderText({ text: name, lang: nameLang, weight: 'extrabold', color: '#ffffff', maxSize: Math.round(nb.h * 0.92), minSize: 20, boxW: nb.w, boxH: nb.h, maxLines: 1 });
    layers.push(place('brand' as PlacedLayer['id'], nt.png, nb.x + (nb.w - nt.width) / 2, nb.y, nt.width, nt.height, nb, nt, name, '#ffffff'));
  }

  // feature BAR (owner's sketch) — typeset by the system (verified spelling): two features in one framed bar under the
  // product, a gold line icon beside each label, a gold divider between them; the first feature on the reading-start
  // side (right in Arabic). One type size for both, never drawn by the AI.
  const feats = ((input as ComposeInput & { features?: string[] }).features ?? []).map((f) => f.trim()).filter(Boolean).slice(0, 2);
  if (g.strip && feats.length) {
    const st = g.strip, n = feats.length, cellW = st.w / n, D = Math.round(st.h * 0.5), gapI = Math.round(st.h * 0.16);
    const labelW = Math.round(cellW - D - gapI - 40), labelH = Math.round(st.h * 0.7);
    const spec = (t: string, size: number) => renderText({ text: t, lang, weight: 'bold', color: '#f6efe0', minSize: Math.min(size, 18), maxSize: size, boxW: labelW, boxH: labelH, maxLines: 1 });
    const first = await Promise.all(feats.map((t) => spec(t, Math.round(st.h * 0.42))));
    const size = Math.max(18, Math.min(...first.map((l) => l.fontSize)));
    const labels = await Promise.all(feats.map((t) => spec(t, size)));
    for (let i = 0; i < n; i++) {
      const slot = lang === 'ar' ? n - 1 - i : i; // Arabic: the first feature in the right cell
      const lbl = labels[i];
      const icon = await svgPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${D}" height="${D}" viewBox="10 10 84 84"><g fill="none" stroke="#e2b84a" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round">${ICONS[ICON_ORDER[i % ICON_ORDER.length]]}</g></svg>`);
      const gw = D + gapI + lbl.width, gh = Math.max(D, lbl.height);
      const png = await sharp({ create: { width: gw, height: gh, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: icon, left: 0, top: Math.round((gh - D) / 2) }, { input: lbl.png, left: D + gapI, top: Math.round((gh - lbl.height) / 2) }]).png().toBuffer();
      const cx = st.x + cellW * slot + cellW / 2;
      const box = { x: Math.round(st.x + cellW * slot + 14), y: st.y + 6, w: Math.round(cellW - 28), h: st.h - 12 };
      layers.push(place(`benefit:${i}` as PlacedLayer['id'], png, Math.round(cx - gw / 2), Math.round(st.y + (st.h - gh) / 2), gw, gh, box, { ...lbl, fits: lbl.fits && gw <= box.w && gh <= box.h }, feats[i], '#f6efe0'));
    }
  }

  // glossy gold order button with a cart and sparkle rays
  // the pill grows with its text (in 60 px steps, up to the frame minus the rays) instead of the CTA overflowing —
  // Malayalam «ഇപ്പോൾ ഓർഡർ ചെയ്യൂ» and long Hindi CTAs did not fit the 500 px square-format pill (design audit)
  const chh = g.cta.h, cy = g.cta.y, rays = 70, maxCw = W - 2 * rays - 40;
  let cw = g.cta.w;
  const ctaText = (w: number) => renderText({ text: input.cta, lang, weight: 'extrabold', color: NAVY, maxSize: Math.round(chh * 0.6), minSize: 28, boxW: w - 170, boxH: chh - 20, maxLines: 1 });
  let t = await ctaText(cw);
  while (!t.fits && cw < maxCw) { cw = Math.min(maxCw, cw + 60); t = await ctaText(cw); }
  const tw = cw + 2 * rays;
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
  const gap = logoBottom ? g.logo.w + 24 : 0; // the logo stands between the two branches
  const inner = W - 2 * g.padX - gap, col = inner / Math.max(1, order.length);
  const labelH = Math.round(g.panel.h * 0.3), pillH = Math.round(g.panel.h * 0.44);
  if (g.bar) {
    const lH = Math.round(g.panel.h * 0.27), nH = Math.round(g.panel.h * 0.5), lY = g.panel.y + Math.round(g.panel.h * 0.09), nY = lY + lH + Math.round(g.panel.h * 0.04);
    for (let i = 0; i < order.length; i++) {
      const c = order[i]; const cx = g.padX + col * i + col / 2 + (i >= order.length / 2 ? gap : 0);
      const lt = await renderText({ text: c.label, lang, weight: 'extrabold', color: '#f6d77a', maxSize: Math.round(lH * 0.85), minSize: 24, boxW: Math.round(col - 24), boxH: lH, maxLines: 1 });
      layers.push(place(`contact:${c.key}:label` as PlacedLayer['id'], lt.png, cx - lt.width / 2, lY + (lH - lt.height) / 2, lt.width, lt.height, { x: Math.round(cx - col / 2 + 12), y: lY, w: Math.round(col - 24), h: lH }, lt, c.label, '#f6d77a'));
      const nt = await renderText({ text: c.phone, lang: lang === 'ml' || lang === 'hi' ? 'en' : lang, weight: 'extrabold', color: WHITE, maxSize: Math.round(nH * 0.95), minSize: 40, boxW: Math.round(col - 56), boxH: nH, maxLines: 1, ltr: true }); // ≥ 28 px from the bar's rounded edge
      layers.push(place(`contact:${c.key}:phone` as PlacedLayer['id'], nt.png, cx - nt.width / 2, nY + (nH - nt.height) / 2, nt.width, nt.height, { x: Math.round(cx - col / 2 + 28), y: nY, w: Math.round(col - 56), h: nH }, nt, c.phone, WHITE));
    }
  }
  const labelY = g.panel.y + Math.round(g.panel.h * 0.08), pillY = g.panel.y + g.panel.h - pillH - Math.round(g.panel.h * 0.1);
  for (let i = 0; i < (g.bar ? 0 : order.length); i++) {
    const c = order[i]; const cx = g.padX + col * i + col / 2 + (logoBottom && i >= order.length / 2 ? gap : 0);
    const lt = await renderText({ text: c.label, lang, weight: 'extrabold', color: '#f6d77a', maxSize: Math.round(labelH * 0.78), minSize: 24, boxW: Math.round(col - 60), boxH: labelH, maxLines: 1 });
    layers.push(place(`contact:${c.key}:label` as PlacedLayer['id'], lt.png, cx - lt.width / 2, labelY + (labelH - lt.height) / 2, lt.width, lt.height, { x: Math.round(cx - col / 2 + 30), y: labelY, w: Math.round(col - 60), h: labelH }, lt, c.label, '#f6d77a'));
    const iconD = Math.round(pillH * 0.62);
    // the digits get every pixel the column allows: icon + 54 px of padding (was a fixed 150 px reserve)
    const nt = await renderText({ text: c.phone, lang: lang === 'ml' || lang === 'hi' ? 'en' : lang, weight: 'extrabold', color: NAVY, maxSize: Math.round(pillH * 0.72), minSize: 36, boxW: Math.round(col - 30 - iconD - 54), boxH: pillH - 8, maxLines: 1, ltr: true });
    const pw = Math.min(Math.round(col - 30), nt.width + iconD + 54);
    const psvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pw}" height="${pillH}"><defs>${goldGrad('g')}</defs><rect x="2" y="2" width="${pw - 4}" height="${pillH - 4}" rx="${(pillH - 4) / 2}" fill="url(#g)" stroke="#fff1b8" stroke-width="3"/>
      <rect x="12" y="6" width="${pw - 24}" height="${pillH * 0.34}" rx="${pillH * 0.17}" fill="#fff" opacity="0.28"/>
      <g transform="translate(18 ${(pillH - iconD) / 2}) scale(${iconD / 100})" fill="${NAVY}">${PHONE}</g></svg>`;
    const ppng = await sharp(await svgPng(psvg)).composite([{ input: nt.png, left: Math.round(20 + iconD + (pw - 20 - iconD - nt.width) / 2 - 4), top: Math.round((pillH - nt.height) / 2) }]).png().toBuffer();
    layers.push(place(`contact:${c.key}:phone` as PlacedLayer['id'], ppng, cx - pw / 2, pillY, pw, pillH, { x: Math.round(cx - col / 2 + 15), y: pillY, w: Math.round(col - 30), h: pillH }, { ...nt, fits: nt.fits && pw <= col - 20 }, c.phone, NAVY, true));
  }

  const png = await sharp(background).composite(layers.map((l) => ({ input: l.png, left: l.left, top: l.top }))).png().toBuffer();
  const manifest: LayerManifest = {
    width: W, height: H, templateKey: AI_POSTER_KEY, lang,
    layers: layers.map((l) => { const i = l.inset ?? 0; return { id: l.id, text: l.text, rect: { left: l.left + i, top: l.top + i, width: l.width - 2 * i, height: l.height - 2 * i }, box: l.box, fits: l.fits, missing: l.missing, fontSize: l.fontSize, color: l.color, solid: l.solid }; }),
  };
  return { width: W, height: H, templateKey: AI_POSTER_KEY, themeKey: 'navy_gold', background, art: parts.art, chrome: parts.chrome, layers, png, manifest };
}
