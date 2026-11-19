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
const L = { logo: { x: 290, y: 236, w: 500, h: 168 }, title: 414, sub: 544, sep: 616, feat: 636, cta: 1258, label: 1374, phone: 1430, footer: 1586, colX: 110 };
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
  return sharp(scene).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
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
  const background = await buildPosterBackground(input.scene, 0);
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

    const nt = await renderText({ text: c.phone, lang: lang === 'ml' ? 'en' : lang, weight: 'extrabold', color: WHITE, maxSize: 60, minSize: 38, boxW: Math.round(colW2 - 160), boxH: 66, maxLines: 1, ltr: true });
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
  // Stories / Reels: everything Instagram must not cover sits inside IG_SAFE_1920 (logo below the account bar, order
  // button + phones above the caption/reply area, panel clear of the Reels side icons, all inside the 3:4 grid crop).
  // The AI art still fills the whole frame; below y≈1540 it is plain background under Instagram's own UI.
  if (h === 1920) return { H: 1920, topBand: 400, topPct: 3, bottomPct: 48, features: null as { y: number; icon: number; label: number } | null, safeWidthPct: 78, padX: 120, logo: { w: 380, h: 150, y: 244 }, cta: { w: 580, h: 100, y: 1222 }, panel: { y: 1350, h: 176 } };
  if (h === 1350) return { H: 1350, topBand: 150, topPct: 3, bottomPct: 40, features: { y: 922, icon: 76, label: 26 } as { y: number; icon: number; label: number } | null, safeWidthPct: 90, padX: 70, logo: { w: 320, h: 130, y: 16 }, cta: { w: 540, h: 90, y: 1058 }, panel: { y: 1162, h: 168 } };
  return { H: h, topBand: 118, topPct: 4, bottomPct: 36, features: null as { y: number; icon: number; label: number } | null, safeWidthPct: 92, padX: 70, logo: { w: 230, h: 100, y: 16 }, cta: { w: 500, h: 82, y: h - 276 }, panel: { y: h - 180, h: 164 } };
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
  const feather = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${artH}"><defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="${(90 / artH).toFixed(4)}" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><rect width="${W}" height="${artH}" fill="url(#f)"/></svg>`);
  const artFeathered = await sharp(art).ensureAlpha().composite([{ input: feather, blend: 'dest-in' }]).png().toBuffer();
  const base = await sharp({ create: { width: W, height: H, channels: 3, background: NAVY } })
    .composite([{ input: edge, left: 0, top: 0 }, { input: artFeathered, left: 0, top: g.topBand }]).png().toBuffer();
  const zone = (g.features?.y ?? g.cta.y) - 70, px = g.padX, pw = W - 2 * px;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs>${goldGrad('gg')}${goldLine('gl')}
      <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${NAVY}" stop-opacity="0"/><stop offset="0.45" stop-color="${NAVY}" stop-opacity="0.55"/><stop offset="1" stop-color="${NAVY}" stop-opacity="0.92"/></linearGradient>
      <linearGradient id="glass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${NAVY2}" stop-opacity="0.94"/><stop offset="1" stop-color="${NAVY}" stop-opacity="0.96"/></linearGradient>
      <linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1b8"/><stop offset="0.5" stop-color="#e6c25a"/><stop offset="1" stop-color="#9c6f1c"/></linearGradient>
      <radialGradient id="lg" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${NAVY}" stop-opacity="0.35"/><stop offset="1" stop-color="${NAVY}" stop-opacity="0"/></radialGradient></defs>
    <ellipse cx="${W / 2}" cy="${g.logo.y + g.logo.h / 2}" rx="${g.logo.w * 0.75}" ry="${g.logo.h * 0.8}" fill="url(#lg)"/>
    <rect x="0" y="${zone}" width="${W}" height="${H - zone}" fill="url(#fade)"/>
    ${ribbons(H)}
    ${g.features ? `<rect x="40" y="${g.features.y - 14}" width="${W - 80}" height="${Math.round(g.features.icon + g.features.label * 1.6 + 26)}" rx="28" fill="${NAVY}" fill-opacity="0.72" stroke="url(#gg)" stroke-opacity="0.55" stroke-width="2"/>` : ''}
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

  // feature row — typeset by the system (verified spelling) in its own row above the order button, never drawn by the AI
  const feats = ((input as ComposeInput & { features?: string[] }).features ?? []).slice(0, 4);
  if (g.features && feats.length) {
    const f = g.features, n = feats.length, colW = (W - 120) / n;
    const order = lang === 'ar' ? feats.map((_, i) => n - 1 - i) : feats.map((_, i) => i);
    for (let slot = 0; slot < n; slot++) {
      const i = order[slot];
      const cx = 60 + colW * slot + colW / 2, D = f.icon;
      const icon = await svgPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${D}" height="${D}" viewBox="0 0 128 128"><defs>${goldGrad('g')}</defs><circle cx="64" cy="64" r="58" fill="${NAVY}" fill-opacity="0.78" stroke="url(#g)" stroke-width="5"/><g transform="translate(32 32) scale(0.64)" fill="none" stroke="#f2cf5b" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">${ICONS[ICON_ORDER[i % ICON_ORDER.length]]}</g></svg>`);
      const lbl = await renderText({ text: feats[i], lang, weight: 'bold', color: '#f6d77a', maxSize: f.label, minSize: 18, boxW: Math.round(colW - 16), boxH: Math.round(f.label * 1.5), maxLines: 1 });
      const cw = Math.round(colW - 8), ch = D + 8 + lbl.height;
      const png = await sharp({ create: { width: cw, height: ch, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: icon, left: Math.round((cw - D) / 2), top: 0 }, { input: lbl.png, left: Math.round((cw - lbl.width) / 2), top: D + 8 }]).png().toBuffer();
      const boxH = g.cta.y - f.y - 8;
      layers.push(place(`benefit:${i}` as PlacedLayer['id'], png, cx - cw / 2, f.y, cw, ch, { x: Math.round(cx - cw / 2), y: f.y, w: cw, h: boxH }, { ...lbl, fits: lbl.fits && ch <= boxH }, feats[i], '#f6d77a'));
    }
  }

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
  const inner = W - 2 * g.padX, col = inner / Math.max(1, order.length);
  const labelH = Math.round(g.panel.h * 0.3), pillH = Math.round(g.panel.h * 0.44);
  const labelY = g.panel.y + Math.round(g.panel.h * 0.08), pillY = g.panel.y + g.panel.h - pillH - Math.round(g.panel.h * 0.1);
  for (let i = 0; i < order.length; i++) {
    const c = order[i]; const cx = g.padX + col * i + col / 2;
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
