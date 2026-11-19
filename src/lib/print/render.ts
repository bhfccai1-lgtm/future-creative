import sharp, { type OverlayOptions } from 'sharp';
import { storage } from '../storage';
import type { Analysis, Brief } from './brief';
import { FAMILIES, spineMm } from './catalog';
import type { Concept } from './concepts';
import { fitText, textImg, type TextImg } from './text';

/**
 * UNIVERSAL DESIGN ENGINE — one composer per product family, all drawn at the exact final size in millimetres
 * (any DPI: the preview and the production file come from the same code). Text, logos and client data are separate
 * real layers composed over the artwork; AI pictures never carry text. Cut / fold / hidden zones are returned as
 * separate vector geometry (mm) for prepress, never baked into the artwork.
 */
export interface Rect { x: number; y: number; w: number; h: number }
export interface Placed { id: string; kind: 'text' | 'image' | 'logo' | 'shape'; rect: Rect; fits: boolean; missing?: string[]; text?: string; pt?: number; srcPx?: { w: number; h: number } }
export interface PrintPage {
  label: string; png: Buffer; widthPx: number; heightPx: number; dpi: number;
  trimMm: { w: number; h: number }; bleedMm: number; safeMm: number;
  /** px rect of the area where important content must stay (trim minus the safe distance; per panel for folded items) */
  safe: Rect[];
  placed: Placed[];
  /** vector geometry in mm, origin = top-left of the media (trim + bleed) */
  cut?: string; kissCut?: string[]; folds?: number[]; hidden?: { label: string; rect: Rect }[];
  /** transparent material / dark fabric: white-ink mask (white = print white) */
  white?: Buffer; transparentBg?: boolean; note?: string;
  /** finishing separations (foil / spot UV / emboss): 100 % black where the finish goes, aligned with the artwork */
  separations?: { finish: string; ids: string[]; png: Buffer; minPt: number | null }[];
  /** internal: element composites of this page (not serialised) */
  _art?: Map<string, OverlayOptions>;
}
export interface DesignInput { a: Analysis; b: Brief; concept: Concept; dpi: number; images?: Record<string, string>; logo?: Buffer | null; preview?: boolean }

interface C { k: number; a: Analysis; b: Brief; cc: Concept; rtl: boolean; images: Record<string, string>; logo: Buffer | null; preview?: boolean; bg?: { data: Buffer; w: number; h: number; s: number } }
/** WCAG relative luminance */
const relLum = (r: number, g: number, b: number) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const hexLum = (hex: string) => { const n = parseInt(hex.slice(1, 7), 16); return relLum((n >> 16) & 255, (n >> 8) & 255, n & 255); };
/** rasterises the background once (small) so every text can sample what is really behind it */
async function setBg(c: C, svg: string, W: number, H: number) {
  const s = Math.min(1, 300 / Math.max(W, H));
  const { data, info } = await sharp(Buffer.from(svg)).resize(Math.max(1, Math.round(W * s)), Math.max(1, Math.round(H * s))).flatten({ background: '#ffffff' }).raw().toBuffer({ resolveWithObject: true });
  c.bg = { data, w: info.width, h: info.height, s };
}
/** keeps the requested colour when it reads (contrast ≥ 3:1 against the real background), otherwise white or ink */
function readable(c: C, color: string, r: Rect): string {
  if (!c.bg) return color;
  const { data, w, h, s } = c.bg; let L = 0, n = 0;
  const x0 = Math.max(0, Math.floor(r.x * s)), x1 = Math.min(w - 1, Math.ceil((r.x + r.w) * s)), y0 = Math.max(0, Math.floor(r.y * s)), y1 = Math.min(h - 1, Math.ceil((r.y + r.h) * s));
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 2) { const i = (y * w + x) * 3; L += relLum(data[i], data[i + 1], data[i + 2]); n++; }
  if (!n) return color;
  const bl = L / n, cl = hexLum(color), ratio = (Math.max(bl, cl) + 0.05) / (Math.min(bl, cl) + 0.05);
  if (ratio >= 3) return color;
  const ink = c.cc.palette.ink, inkL = hexLum(ink);
  const white = (1.05) / (bl + 0.05), dark = (Math.max(bl, inkL) + 0.05) / (Math.min(bl, inkL) + 0.05);
  return white >= dark ? '#ffffff' : ink;
}
const T = (c: C, id: string) => c.b.texts[id as keyof Brief['texts']] as string;
const onDark = (hex: string) => { const n = parseInt(hex.slice(1), 16); const l = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255); return l < 140; };
const ink = (c: C, bg: string) => (onDark(bg) ? '#ffffff' : c.cc.palette.ink);
const blank = () => sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();

class Canvas {
  svg: string[] = []; comps: OverlayOptions[] = []; placed: Placed[] = [];
  /** element id → its composite entry (same object: later moves apply) — the source of finishing separations */
  art = new Map<string, OverlayOptions>();
  put(img: { png: Buffer; w: number; h: number }, x: number, y: number) { this.comps.push({ input: img.png, left: Math.round(x), top: Math.round(y) }); return this.comps[this.comps.length - 1]; }
  text(id: string, t: TextImg & { pt?: number }, x: number, y: number, text: string) { this.art.set(id, this.put(t, x, y)); this.placed.push({ id, kind: 'text', rect: { x: Math.round(x), y: Math.round(y), w: t.w, h: t.h }, fits: t.fits, missing: t.missing, text, pt: t.pt }); }
}

/** places an aligned text block inside rect starting at y; returns the next y */
async function line(c: C, cv: Canvas, id: string, str: string, r: Rect, y: number, o: { pt: number; minPt?: number; weight?: 'regular' | 'bold' | 'extrabold'; color: string; align?: 'centre' | 'start'; maxH?: number }) {
  if (!str.trim()) return y;
  const color = readable(c, o.color, { x: r.x, y, w: r.w, h: Math.min(o.maxH ?? r.h, (o.pt * c.k * 25.4) / 72 * 1.4) });
  const t = await fitText(str, { maxPt: o.pt, minPt: o.minPt ?? Math.max(7, o.pt * 0.7), kmm: c.k, w: r.w, h: o.maxH ?? r.y + r.h - y, weight: o.weight, color, align: o.align === 'centre' ? 'centre' : undefined });
  const x = o.align === 'centre' ? r.x + (r.w - t.w) / 2 : c.rtl ? r.x + r.w - t.w : r.x;
  cv.text(id, t, x, y, str);
  return y + t.h;
}

async function image(c: C, cv: Canvas, slot: string, r: Rect, o: { radius?: number; fit?: 'cover' | 'contain'; id?: string } = {}) {
  const key = c.images[slot]; if (!key || r.w < 4 || r.h < 4) return false;
  try {
    const buf = await storage().get(key); const meta = await sharp(buf).metadata();
    let img = await sharp(buf).resize(Math.round(r.w), Math.round(r.h), { fit: o.fit ?? 'cover', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    if (o.radius) img = await sharp(img).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(r.w)}" height="${Math.round(r.h)}"><rect width="${Math.round(r.w)}" height="${Math.round(r.h)}" rx="${o.radius}" fill="#fff"/></svg>`), blend: 'dest-in' }]).png().toBuffer();
    cv.put({ png: img, w: r.w, h: r.h }, r.x, r.y);
    cv.placed.push({ id: o.id ?? `img:${slot}`, kind: 'image', rect: { ...r }, fits: true, srcPx: { w: meta.width ?? 0, h: meta.height ?? 0 } });
    return true;
  } catch { return false; }
}

/** the client's ORIGINAL logo (never generated); without one, the business name is set as a wordmark */
async function logo(c: C, cv: Canvas, r: Rect, color: string, align: 'centre' | 'start' = 'centre') {
  if (c.logo) {
    const meta = await sharp(c.logo).metadata();
    const s = Math.min(r.w / (meta.width ?? 1), r.h / (meta.height ?? 1));
    const w = Math.max(1, Math.round((meta.width ?? 1) * s)), h = Math.max(1, Math.round((meta.height ?? 1) * s));
    const png = await sharp(c.logo).resize(w, h).png().toBuffer();
    const x = align === 'centre' ? r.x + (r.w - w) / 2 : c.rtl ? r.x + r.w - w : r.x;
    cv.art.set('logo', cv.put({ png, w, h }, x, r.y + (r.h - h) / 2));
    cv.placed.push({ id: 'logo', kind: 'logo', rect: { x: Math.round(x), y: Math.round(r.y + (r.h - h) / 2), w, h }, fits: true, srcPx: { w: meta.width ?? 0, h: meta.height ?? 0 } });
    return r.y + r.h;
  }
  const name = c.b.business || T(c, 'name');
  if (!name || name.trim().toLowerCase() === T(c, 'headline').trim().toLowerCase()) return r.y;
  color = readable(c, color, r);
  const t = await fitText(name, { maxPt: (r.h / c.k) * 2.0, minPt: 7, kmm: c.k, w: r.w, h: r.h, weight: 'extrabold', color, align: align === 'centre' ? 'centre' : undefined });
  const x = align === 'centre' ? r.x + (r.w - t.w) / 2 : c.rtl ? r.x + r.w - t.w : r.x;
  cv.text('wordmark', t, x, r.y + (r.h - t.h) / 2, name);
  return r.y + r.h;
}

function contactsOf(c: C) {
  const t = c.b.texts, en = c.b.lang === 'en';
  return [t.phone && `${en ? 'Tel' : 'هاتف'}: ${t.phone}`, t.email, t.website, t.address].filter(Boolean) as string[];
}

/** concept background: fills to the bleed edge; decoration stays outside the safe text area where possible */
function background(c: C, W: number, H: number, b: number, safe: Rect): string {
  const p = c.cc.palette, k = c.k, out: string[] = [`<rect width="${W}" height="${H}" fill="${p.bg}"/>`];
  if (c.cc.layout === 'band') out.push(`<rect width="${W}" height="${Math.round(b + (H - 2 * b) * 0.3)}" fill="${p.primary}"/><rect y="${Math.round(b + (H - 2 * b) * 0.3)}" width="${W}" height="${Math.max(2, k * 1.2)}" fill="${p.secondary}"/>`);
  if (c.cc.layout === 'split') { const X = (v: number) => (c.rtl ? v : W - v); out.push(`<polygon points="${X(0)},0 ${X(W * 0.4)},0 ${X(W * 0.28)},${H} ${X(0)},${H}" fill="${p.primary}"/><polygon points="${X(W * 0.4)},0 ${X(W * 0.43)},0 ${X(W * 0.31)},${H} ${X(W * 0.28)},${H}" fill="${p.secondary}"/>`); }
  if (c.cc.layout === 'frame') out.push(`<rect x="${safe.x - k * 1.5}" y="${safe.y - k * 1.5}" width="${safe.w + k * 3}" height="${safe.h + k * 3}" fill="none" stroke="${p.secondary}" stroke-width="${Math.max(1, k * 0.35)}"/><rect x="${safe.x - k * 2.6}" y="${safe.y - k * 2.6}" width="${safe.w + k * 5.2}" height="${safe.h + k * 5.2}" fill="none" stroke="${p.secondary}" stroke-opacity="0.55" stroke-width="${Math.max(1, k * 0.15)}"/>`);
  const d = c.cc.decor, m = Math.min(W, H);
  if (d === 'soft_shapes') out.push(`<circle cx="${W}" cy="0" r="${m * 0.35}" fill="${p.secondary}" fill-opacity="0.18"/><circle cx="0" cy="${H}" r="${m * 0.28}" fill="${p.accent}" fill-opacity="0.14"/>`);
  if (d === 'playful') for (let i = 0; i < 14; i++) { const x = ((i * 0.618) % 1) * W, y = i % 2 ? H - b - k * 3 - (i % 3) * k * 2 : b + k * 2 + (i % 3) * k * 2; out.push(`<circle cx="${x}" cy="${y}" r="${k * (1 + (i % 3))}" fill="${[p.primary, p.secondary, p.accent][i % 3]}" fill-opacity="0.7"/>`); }
  if (d === 'geometric') out.push(`<polygon points="${W},${H} ${W - m * 0.3},${H} ${W},${H - m * 0.3}" fill="${p.secondary}" fill-opacity="0.85"/><polygon points="${W},${H} ${W - m * 0.16},${H} ${W},${H - m * 0.16}" fill="${p.accent}"/>`);
  if (d === 'organic') out.push(`<path d="M0 ${H * 0.82} C ${W * 0.3} ${H * 0.74} ${W * 0.6} ${H * 0.95} ${W} ${H * 0.84} L ${W} ${H} L 0 ${H} Z" fill="${p.secondary}" fill-opacity="0.25"/>`);
  if (d === 'grid') { const st = k * 10; for (let x = 0; x < W; x += st) out.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${p.ink}" stroke-opacity="0.05" stroke-width="1"/>`); }
  if (d === 'gold_lines') out.push(`<line x1="0" y1="${H - b - k * 2}" x2="${W}" y2="${H - b - k * 2}" stroke="${p.secondary}" stroke-width="${Math.max(1, k * 0.5)}"/>`);
  if (d === 'ornament') { const r = Math.min(safe.x, safe.y) * 0.9; for (const [x, y] of [[0, 0], [W, 0], [0, H], [W, H]]) out.push(`<circle cx="${x}" cy="${y}" r="${r * 1.6}" fill="none" stroke="${p.secondary}" stroke-width="${Math.max(1, k * 0.4)}"/><circle cx="${x}" cy="${y}" r="${r * 1.1}" fill="none" stroke="${p.secondary}" stroke-opacity="0.6" stroke-width="${Math.max(1, k * 0.25)}"/>`); }
  return out.join('');
}

/** the shared composition for flat sheets / panels / banners: logo · headline · subline | picture · body · extras | CTA · contacts */
async function composeSheet(c: C, cv: Canvas, r: Rect, o: { scale: number; dark: boolean; heroSlot?: string; contacts?: boolean; body?: boolean; minHeadlineMm?: number; noBand?: boolean }) {
  const col = o.dark ? '#ffffff' : c.cc.palette.ink, acc = o.dark ? c.cc.palette.secondary : c.cc.palette.primary, s = o.scale;
  if (c.cc.layout === 'split') r = c.rtl ? { ...r, x: r.x + r.w * 0.4, w: r.w * 0.6 } : { ...r, w: r.w * 0.6 };
  const centre = c.cc.layout !== 'split' ? 'centre' : 'start';
  const band = c.cc.layout === 'band' && !o.noBand;
  const start = { comps: cv.comps.length, placed: cv.placed.length };
  let heroPlaced = false;
  let y = r.y;
  y = await logo(c, cv, { x: r.x, y, w: r.w, h: r.h * (band ? 0.08 : 0.11) }, acc, centre) + r.h * 0.02;
  const minPt = o.minHeadlineMm ? (o.minHeadlineMm / 0.7) * 72 / 25.4 : Math.max(9, 12 * s);
  const head = T(c, 'headline') || c.b.business;
  y = await line(c, cv, 'headline', head, r, y, { pt: 30 * s, minPt: Math.min(minPt, 30 * s), weight: 'extrabold', color: band ? '#ffffff' : acc, align: centre, maxH: r.h * (band ? 0.16 : 0.24) }) + r.h * 0.015;
  if (band) y = Math.max(y, r.y + r.h * 0.3);
  y = await line(c, cv, 'subline', T(c, 'subline'), r, y, { pt: 14 * s, weight: 'bold', color: col, align: centre, maxH: r.h * 0.12 }) + r.h * 0.03;
  // bottom anchor: CTA + contacts
  const gap = c.k * 2.4 * s;
  const tail: { id: string; str: string; pt: number; weight: 'regular' | 'bold' | 'extrabold'; color: string; pill?: boolean }[] = [];
  if (T(c, 'cta')) tail.push({ id: 'cta', str: T(c, 'cta'), pt: 15 * s, weight: 'extrabold', color: acc, pill: true });
  if (o.contacts !== false) { const cts = contactsOf(c); if (cts.length) tail.push({ id: 'contacts', str: cts.join(' · '), pt: 10 * s, weight: 'bold', color: col }); }
  const mid: typeof tail = [];
  if (o.body !== false && T(c, 'body')) mid.push({ id: 'body', str: T(c, 'body'), pt: 12 * s, weight: 'regular', color: col });
  for (const [i, e] of c.b.texts.extra.entries()) mid.push({ id: `extra:${i}`, str: `• ${e}`, pt: 12.5 * s, weight: 'bold', color: col });
  const render = async (xs: typeof tail, yy: number) => Promise.all(xs.map(async (bl) => fitText(bl.str, { maxPt: bl.pt, minPt: Math.max(7, bl.pt * 0.7), kmm: c.k, w: r.w, h: r.h * 0.4, weight: bl.weight, color: readable(c, bl.color, { x: r.x, y: yy, w: r.w, h: c.k * 8 }), align: centre === 'centre' ? 'centre' : undefined })));
  const tailImg = await render(tail, r.y + r.h - c.k * 10);
  const tailH = tailImg.reduce((a, t) => a + t.h + gap, 0);
  const midImg = await render(mid, y);
  const midH = midImg.reduce((a, t) => a + t.h + gap, 0);
  const free = r.y + r.h - tailH - y;
  // the picture takes what the copy leaves (never less than 15 % of the area)
  const heroH = free - midH - gap;
  if (o.heroSlot && heroH > r.h * 0.15 && await image(c, cv, o.heroSlot, { x: r.x, y, w: r.w, h: heroH }, { radius: c.k * 3 })) { y += heroH + gap; heroPlaced = true; }
  else if (o.heroSlot && heroH > r.h * 0.15 && c.preview) {
    // preview only: show where the AI picture will go (never in a production file)
    cv.svg.push(`<rect x="${r.x}" y="${y}" width="${r.w}" height="${heroH}" rx="${c.k * 3}" fill="${c.cc.palette.primary}" fill-opacity="0.06" stroke="${c.cc.palette.primary}" stroke-opacity="0.35" stroke-dasharray="${c.k * 3} ${c.k * 2}" stroke-width="${Math.max(1, c.k * 0.4)}"/><circle cx="${r.x + r.w / 2}" cy="${y + heroH / 2}" r="${Math.min(r.w, heroH) * 0.12}" fill="none" stroke="${c.cc.palette.primary}" stroke-opacity="0.35" stroke-width="${Math.max(1, c.k * 0.5)}"/>`);
    y += heroH + gap; heroPlaced = true;
  }
  // copy block centred in the space that is left
  const my = y + Math.max(0, (r.y + r.h - tailH - y - midH) / 2);
  const place = async (xs: typeof tail, imgs: Awaited<ReturnType<typeof render>>, yy: number) => {
    for (const [i, t] of imgs.entries()) {
      const x = centre === 'centre' ? r.x + (r.w - t.w) / 2 : c.rtl ? r.x + r.w - t.w : r.x;
      if (xs[i].pill) { const ph = t.h + c.k * 2.4; const pill = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(t.w + c.k * 8)}" height="${Math.round(ph)}"><rect x="1" y="1" width="${Math.round(t.w + c.k * 8) - 2}" height="${Math.round(ph) - 2}" rx="${ph / 2}" fill="${acc}" fill-opacity="0.12" stroke="${acc}" stroke-width="${Math.max(1, c.k * 0.3)}"/></svg>`)).png().toBuffer(); cv.put({ png: pill, w: 0, h: 0 }, x - c.k * 4, yy - c.k * 1.2); }
      cv.text(xs[i].id, { ...t, fits: t.fits && yy + t.h <= r.y + r.h + 2 }, x, yy, xs[i].str);
      yy += t.h + gap;
    }
  };
  await place(mid, midImg, my);
  await place(tail, tailImg, Math.max(my + midH, r.y + r.h - tailH));
  // nothing to fill the middle (no picture, short copy): centre the whole composition vertically (not over a colour band)
  if (!heroPlaced && !band && !tail.length) centreV(cv, start, r);
}
/** moves what was placed since `start` so it sits vertically centred in r */
function centreV(cv: Canvas, start: { comps: number; placed: number }, r: Rect) {
  const ps = cv.placed.slice(start.placed); if (!ps.length) return;
  const top = Math.min(...ps.map((p) => p.rect.y)), bottom = Math.max(...ps.map((p) => p.rect.y + p.rect.h));
  const dy = Math.round(r.y + (r.h - (bottom - top)) / 2 - top);
  if (dy > 0) { for (const cp of cv.comps.slice(start.comps)) cp.top = (cp.top ?? 0) + dy; for (const p of ps) p.rect.y += dy; }
}

async function flatten(W: number, H: number, bgSvg: string, cv: Canvas, transparent = false) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${transparent ? '' : bgSvg}${cv.svg.join('')}</svg>`;
  return sharp({ create: { width: W, height: H, channels: 4, background: transparent ? { r: 0, g: 0, b: 0, alpha: 0 } : '#ffffff' } }).composite([{ input: Buffer.from(svg) }, ...cv.comps]).png({ compressionLevel: 6 }).toBuffer();
}
const rectPath = (x: number, y: number, w: number, h: number, r = 0) => r ? `M${x + r} ${y} H${x + w - r} A${r} ${r} 0 0 1 ${x + w} ${y + r} V${y + h - r} A${r} ${r} 0 0 1 ${x + w - r} ${y + h} H${x + r} A${r} ${r} 0 0 1 ${x} ${y + h - r} V${y + r} A${r} ${r} 0 0 1 ${x + r} ${y} Z` : `M${x} ${y} H${x + w} V${y + h} H${x} Z`;
const circlePath = (cx: number, cy: number, rx: number, ry = rx) => `M${cx - rx} ${cy} A${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;
const n1 = (v: number) => Math.round(v * 100) / 100;

/** which elements carry the finish: the client's choice (default: logo + headline / the name on a card back) */
export const FINISH_TARGETS: Record<string, string[]> = { logo: ['logo', 'wordmark'], headline: ['headline'], logo_headline: ['logo', 'wordmark', 'headline'], name: ['name', 'logo', 'wordmark'] };
const SEPARATED = ['gold_foil', 'silver_foil', 'spot_uv', 'emboss', 'deboss'];

export async function renderDesign(inp: DesignInput): Promise<PrintPage[]> {
  const pages = await renderInner(inp);
  const finishes = inp.b.finishes.filter((f) => SEPARATED.includes(f) && inp.a.product.finishes.includes(f));
  if (finishes.length) {
    const want = FINISH_TARGETS[inp.b.finishTarget] ?? FINISH_TARGETS.logo_headline;
    for (const pg of pages) {
      if (!pg._art || pg.note === 'mirrored') continue;
      const ids = want.filter((id) => pg._art!.has(id));
      if (!ids.length) continue;
      const layers: OverlayOptions[] = [];
      for (const id of ids) {
        const c = pg._art.get(id)!;
        // the element's own alpha → solid black (same position, same size): a pixel-exact plate
        const black = await sharp(c.input as Buffer).ensureAlpha().linear([0, 0, 0, 1], [0, 0, 0, 0]).png().toBuffer();
        layers.push({ input: black, left: c.left, top: c.top });
      }
      const png = await sharp({ create: { width: pg.widthPx, height: pg.heightPx, channels: 3, background: '#ffffff' } }).composite(layers).flatten({ background: '#ffffff' }).toColourspace('b-w').png().toBuffer();
      const pts = pg.placed.filter((x) => ids.includes(x.id) && x.pt).map((x) => x.pt!);
      pg.separations = finishes.map((finish) => ({ finish, ids, png, minPt: pts.length ? Math.min(...pts) : null }));
    }
  }
  return pages;
}

async function renderInner(inp: DesignInput): Promise<PrintPage[]> {
  const { a, b } = inp;
  const c: C = { k: inp.dpi / 25.4, a, b, cc: inp.concept, rtl: b.lang !== 'en', images: inp.images ?? {}, logo: inp.logo ?? null, preview: inp.preview };
  const fam = a.product.family, bl = a.bleedMm, sf = a.safeMm, k = c.k;
  const W = Math.round((a.trim.w + 2 * bl) * k), H = Math.round((a.trim.h + 2 * bl) * k), B = Math.round(bl * k);
  const safeR = (x0 = 0, w = a.trim.w): Rect => ({ x: Math.round((bl + x0 + sf) * k), y: Math.round((bl + sf) * k), w: Math.round((w - 2 * sf) * k), h: Math.round((a.trim.h - 2 * sf) * k) });
  const page = (label: string, png: Buffer, cv: Canvas, safe: Rect[], extra: Partial<PrintPage> = {}): PrintPage => ({ label, png, widthPx: W, heightPx: H, dpi: inp.dpi, trimMm: a.trim, bleedMm: bl, safeMm: sf, safe, placed: cv.placed, _art: cv.art, ...extra });
  const trimCut = rectPath(n1(bl), n1(bl), n1(a.trim.w), n1(a.trim.h));
  const scaleFor = (wMm: number, hMm: number) => Math.max(0.35, Math.min(8, Math.sqrt((wMm * hMm) / (148 * 210))));
  const en = b.lang === 'en';

  if (fam === 'card') {
    const pages: PrintPage[] = [];
    // card type sizes are absolute (a card is read at hand distance whatever its exact size)
    const s = Math.max(1, Math.min(1.6, scaleFor(a.trim.w, a.trim.h) / 0.38));
    // FRONT: identity
    { const cv = new Canvas(); const sr = safeR(); const bg = background(c, W, H, B, sr); await setBg(c, `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${bg}</svg>`, W, H);
      const dark = c.cc.layout === 'split' ? false : onDark(c.cc.layout === 'band' ? c.cc.palette.primary : c.cc.palette.bg);
      const lr = c.cc.layout === 'split' ? { x: sr.x, y: sr.y + sr.h * 0.18, w: sr.w * 0.5, h: sr.h * 0.5 } : { x: sr.x + sr.w * 0.15, y: sr.y + sr.h * (c.cc.layout === 'band' ? 0.02 : 0.2), w: sr.w * 0.7, h: sr.h * (c.cc.layout === 'band' ? 0.3 : 0.42) };
      if (c.cc.layout === 'split') lr.x = c.rtl ? sr.x : sr.x;
      await logo(c, cv, lr, c.cc.layout === 'split' ? '#ffffff' : dark ? '#ffffff' : c.cc.palette.primary);
      const ty = c.cc.layout === 'band' ? sr.y + sr.h * 0.45 : lr.y + lr.h + sr.h * 0.06;
      const tr = c.cc.layout === 'split' ? { ...sr, x: sr.x + sr.w * 0.52, w: sr.w * 0.48 } : sr;
      let y = await line(c, cv, 'tagline', T(c, 'subline') || b.activity, tr, ty, { pt: 7.5 * s, minPt: 6, weight: 'bold', color: c.cc.layout === 'split' ? c.cc.palette.ink : ink(c, c.cc.palette.bg), align: c.cc.layout === 'split' ? 'start' : 'centre', maxH: sr.h * 0.3 });
      if (c.cc.layout === 'band') { y += k * 2; await line(c, cv, 'headline', T(c, 'headline'), sr, y, { pt: 10 * s, minPt: 7, weight: 'extrabold', color: c.cc.palette.primary, align: 'centre', maxH: sr.h * 0.25 }); }
      pages.push(page(en ? 'Front' : 'الوجه الأمامي', await flatten(W, H, bg, cv), cv, [sr], { cut: trimCut })); }
    if (a.sides === 2) { const cv = new Canvas(); const sr = safeR();
      const bg = `<rect width="${W}" height="${H}" fill="${c.cc.layout === 'frame' ? c.cc.palette.bg : '#ffffff'}"/><rect width="${W}" height="${Math.round(B + k * 2.2)}" fill="${c.cc.palette.primary}"/><rect y="${H - Math.round(B + k * 2.2)}" width="${W}" height="${Math.round(B + k * 2.2)}" fill="${c.cc.palette.secondary}"/>`;
      await setBg(c, `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${bg}</svg>`, W, H);
      let y = sr.y + sr.h * 0.06;
      y = await line(c, cv, 'name', T(c, 'name'), sr, y, { pt: 11 * s, minPt: 7.5, weight: 'extrabold', color: c.cc.palette.primary, maxH: sr.h * 0.22 });
      y = await line(c, cv, 'role', T(c, 'role'), sr, y, { pt: 7.5 * s, minPt: 6.5, weight: 'bold', color: c.cc.palette.ink, maxH: sr.h * 0.16 }) + k * 2;
      cv.svg.push(`<rect x="${c.rtl ? sr.x + sr.w - k * 12 : sr.x}" y="${y}" width="${k * 12}" height="${Math.max(1, k * 0.5)}" fill="${c.cc.palette.secondary}"/>`); y += k * 2.5;
      // contact data: never below 6.5 pt on a card (readability at the final size)
      for (const [i, s2] of contactsOf(c).entries()) y = await line(c, cv, `contact:${i}`, s2, sr, y, { pt: 7 * s, minPt: 6.5, weight: 'regular', color: c.cc.palette.ink, maxH: sr.y + sr.h - y }) + k * 0.6;
      pages.push(page(en ? 'Back' : 'الوجه الخلفي', await flatten(W, H, bg, cv), cv, [sr], { cut: trimCut })); }
    return pages;
  }

  if (fam === 'folded') {
    // letter (tri) fold: the panel that folds in is 2 mm narrower so it closes without buckling; bi-fold = 2 equal panels
    const tri = !/bi/.test(b.sizeId);
    const pw = tri ? [(a.trim.w + 2) / 3, (a.trim.w + 2) / 3, (a.trim.w + 2) / 3 - 2] : [a.trim.w / 2, a.trim.w / 2];
    const sides = [c.rtl ? pw : [...pw].reverse(), c.rtl ? [...pw].reverse() : pw];
    const pages: PrintPage[] = [];
    for (let side = 0; side < 2; side++) {
      const cv = new Canvas(); const ws = sides[side]; const xs = ws.map((_, i) => ws.slice(0, i).reduce((s, v) => s + v, 0));
      const safes = ws.map((w, i) => { const r = safeR(xs[i], w); return i > 0 ? { ...r, x: r.x + Math.round(k * 1), w: r.w - Math.round(k * 1) } : r; });
      const bg = background(c, W, H, B, safes[0]); await setBg(c, `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${bg}</svg>`, W, H);
      const s = scaleFor(ws[0], a.trim.h) * 1.05;
      if (side === 0) {
        const front = c.rtl ? 0 : ws.length - 1, back = tri ? 1 : (c.rtl ? 1 : 0);
        await composeSheet(c, cv, safes[front], { scale: s, dark: false, heroSlot: 'hero', contacts: false, body: false });
        if (tri) { const flap = c.rtl ? 2 : 0; let y = safes[flap].y; y = await line(c, cv, 'flap:title', en ? 'About us' : 'من نحن', safes[flap], y, { pt: 14 * s, weight: 'extrabold', color: c.cc.palette.primary }) + k * 3; await line(c, cv, 'flap:body', T(c, 'body'), safes[flap], y, { pt: 10 * s, color: c.cc.palette.ink }); }
        let y = safes[back].y + safes[back].h * 0.35; y = await logo(c, cv, { ...safes[back], y, h: safes[back].h * 0.15 }, c.cc.palette.primary) + k * 4;
        for (const [i, s2] of contactsOf(c).entries()) y = await line(c, cv, `contact:${i}`, s2, safes[back], y, { pt: 9.5 * s, minPt: 7, color: c.cc.palette.ink, align: 'centre' }) + k;
      } else {
        const items = c.b.texts.extra.length ? c.b.texts.extra : [T(c, 'body')].filter(Boolean);
        for (let i = 0; i < ws.length; i++) {
          const ord = c.rtl ? ws.length - 1 - i : i; const r = safes[ord];
          const part = items.filter((_, j) => j % ws.length === i);
          let y = r.y; if (i === 0) y = await line(c, cv, 'inside:headline', T(c, 'headline'), r, y, { pt: 16 * s, weight: 'extrabold', color: c.cc.palette.primary }) + k * 4;
          if (i === 1) { const ok = await image(c, cv, 'hero', { x: r.x, y, w: r.w, h: r.h * 0.4 }, { radius: k * 3, id: 'img:inside' }); if (ok) y += r.h * 0.4 + k * 4; }
          for (const [j, it] of part.entries()) y = await line(c, cv, `inside:${i}:${j}`, `• ${it}`, r, y, { pt: 11 * s, minPt: 8, weight: 'bold', color: c.cc.palette.ink }) + k * 2.5;
        }
      }
      const folds = xs.slice(1).map((x) => n1(bl + x));
      pages.push(page(side === 0 ? (en ? 'Outside' : 'الوجه الخارجي') : (en ? 'Inside' : 'الوجه الداخلي'), await flatten(W, H, bg, cv), cv, safes, { cut: trimCut, folds, note: tri ? (en ? 'Letter fold: the fold-in panel is 2 mm narrower' : 'طي ثلاثي: اللوح الداخلي أضيق 2 مم') : undefined }));
    }
    return pages;
  }

  if (fam === 'multipage') {
    // cover spread = back · spine · front ; interior = left/right master pages with a wider binding margin
    const spine = /perfect|hard/.test(b.finishes.join(',')) || a.pages > 64 ? spineMm(a.pages) : 0;
    const SW = Math.round((a.trim.w * 2 + spine + 2 * bl) * k);
    const cv = new Canvas();
    const frontX = c.rtl ? 0 : a.trim.w + spine, backX = c.rtl ? a.trim.w + spine : 0;
    const fr: Rect = { x: Math.round((bl + frontX + sf) * k), y: Math.round((bl + sf) * k), w: Math.round((a.trim.w - 2 * sf) * k), h: Math.round((a.trim.h - 2 * sf) * k) };
    const br: Rect = { ...fr, x: Math.round((bl + backX + sf) * k) };
    const bg = `<rect width="${SW}" height="${H}" fill="${c.cc.palette.bg}"/><rect x="${Math.round((bl + frontX) * k)}" width="${Math.round(a.trim.w * k) + (c.rtl ? B : B)}" height="${Math.round(H * 0.35)}" fill="${c.cc.palette.primary}"/>${spine ? `<rect x="${Math.round((bl + a.trim.w) * k)}" width="${Math.round(spine * k)}" height="${H}" fill="${c.cc.palette.primary}"/>` : ''}`;
    await setBg(c, `<svg xmlns="http://www.w3.org/2000/svg" width="${SW}" height="${H}">${bg}</svg>`, SW, H);
    await composeSheet(c, cv, fr, { scale: scaleFor(a.trim.w, a.trim.h), dark: false, heroSlot: 'hero', contacts: false, body: false });
    let y = br.y + br.h * 0.5; for (const [i, s2] of contactsOf(c).entries()) y = await line(c, cv, `back:${i}`, s2, br, y, { pt: 10, color: c.cc.palette.ink, align: 'centre' }) + k;
    if (spine >= 5 && (T(c, 'headline') || b.business)) {
      const st = await textImg(T(c, 'headline') || b.business, { pt: Math.min(12, spine * 0.55 * 72 / 25.4), kmm: k, w: Math.round(a.trim.h * k * 0.8), weight: 'extrabold', color: '#ffffff', align: 'centre' });
      const rot = await sharp(st.png).rotate(c.rtl ? -90 : 90, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer(); const m = await sharp(rot).metadata();
      const sx = Math.round((bl + a.trim.w + spine / 2) * k - (m.width ?? 0) / 2);
      cv.put({ png: rot, w: m.width ?? 0, h: m.height ?? 0 }, sx, (H - (m.height ?? 0)) / 2);
      cv.placed.push({ id: 'spine', kind: 'text', rect: { x: sx, y: Math.round((H - (m.height ?? 0)) / 2), w: m.width ?? 0, h: m.height ?? 0 }, fits: (m.width ?? 0) <= spine * k + 2, text: 'spine' });
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SW}" height="${H}">${bg}${cv.svg.join('')}</svg>`;
    const png = await sharp({ create: { width: SW, height: H, channels: 4, background: '#ffffff' } }).composite([{ input: Buffer.from(svg) }, ...cv.comps]).png().toBuffer();
    const cover: PrintPage = { label: en ? `Cover spread (spine ${spine} mm)` : `الغلاف المفرود (الكعب ${spine} مم)`, png, widthPx: SW, heightPx: H, dpi: inp.dpi, trimMm: { w: a.trim.w * 2 + spine, h: a.trim.h }, bleedMm: bl, safeMm: sf, safe: [fr, br, { x: Math.round((bl + a.trim.w) * k), y: Math.round((bl + sf) * k), w: Math.round(spine * k), h: Math.round((a.trim.h - 2 * sf) * k) }], placed: cv.placed, cut: rectPath(bl, bl, n1(a.trim.w * 2 + spine), a.trim.h), folds: spine ? [n1(bl + a.trim.w), n1(bl + a.trim.w + spine)] : [n1(bl + a.trim.w)] };
    const masters: PrintPage[] = [];
    for (const side of ['right', 'left'] as const) {
      const cv2 = new Canvas(); const inner = 15, outer = 10, top = 12, bottom = 15;
      const bindRight = (side === 'left') !== c.rtl; // binding edge
      const r: Rect = { x: Math.round((bl + (bindRight ? outer : inner)) * k), y: Math.round((bl + top) * k), w: Math.round((a.trim.w - inner - outer) * k), h: Math.round((a.trim.h - top - bottom) * k) };
      const head = await textImg(T(c, 'headline') || b.business || '', { pt: 8, kmm: k, w: r.w, color: c.cc.palette.primary, weight: 'bold' });
      if (head.w > 1) cv2.text('running_head', head, c.rtl ? r.x + r.w - head.w : r.x, Math.round((bl + 6) * k), 'head');
      const pn = await textImg(side === 'right' ? '1' : '2', { pt: 9, kmm: k, w: k * 20, color: c.cc.palette.ink, weight: 'bold', align: 'centre' });
      cv2.text('page_number', pn, bindRight ? r.x : r.x + r.w - pn.w, Math.round((bl + a.trim.h - 9) * k), 'n');
      cv2.svg.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="none" stroke="${c.cc.palette.primary}" stroke-opacity="0.25" stroke-dasharray="${k * 2} ${k * 2}" stroke-width="1"/>`);
      masters.push(page(en ? `Master page (${side})` : `قالب صفحة داخلية (${side === 'right' ? 'يمين' : 'يسار'})`, await flatten(W, H, `<rect width="${W}" height="${H}" fill="#ffffff"/>`, cv2), cv2, [{ x: Math.round((bl + 5) * k), y: Math.round((bl + 4) * k), w: Math.round((a.trim.w - 10) * k), h: Math.round((a.trim.h - 8) * k) }], { cut: trimCut, note: en ? `inner (binding) margin ${inner} mm, outer ${outer} mm — the dashed area is where the client's text goes` : `هامش التجليد ${inner} مم والخارجي ${outer} مم — المنطقة المتقطعة لمحتوى العميل` }));
    }
    return [cover, ...masters];
  }

  if (fam === 'sticker' || fam === 'label' || fam === 'stamp') {
    const cut = a.product.cut ?? 'rect';
    const cx = bl + a.trim.w / 2, cy = bl + a.trim.h / 2;
    const path = cut === 'circle' ? circlePath(n1(cx), n1(cy), n1(a.trim.w / 2), n1(a.trim.h / 2)) : rectPath(n1(bl), n1(bl), n1(a.trim.w), n1(a.trim.h), cut === 'rect' ? 0 : n1(Math.min(a.trim.w, a.trim.h) * 0.12));
    const cv = new Canvas();
    const stamp = fam === 'stamp';
    const p = c.cc.palette, colr = stamp ? '#000000' : p.primary;
    const inset = (cut === 'circle' ? Math.min(a.trim.w, a.trim.h) * 0.146 : 0) + sf;
    const sr: Rect = { x: Math.round((bl + inset) * k), y: Math.round((bl + inset) * k), w: Math.round((a.trim.w - 2 * inset) * k), h: Math.round((a.trim.h - 2 * inset) * k) };
    const transparent = !!a.material && /transparent/.test(a.material);
    const bg = stamp ? `<rect width="${W}" height="${H}" fill="#ffffff"/><path d="${scaleP(path, k)}" fill="none" stroke="#000" stroke-width="${k * 0.8}"/><path d="${scaleP(cut === 'circle' ? circlePath(n1(cx), n1(cy), n1(a.trim.w / 2 - 2), n1(a.trim.h / 2 - 2)) : rectPath(n1(bl + 1.5), n1(bl + 1.5), n1(a.trim.w - 3), n1(a.trim.h - 3)), k)}" fill="none" stroke="#000" stroke-width="${k * 0.4}"/>`
      : transparent ? '' : `<defs><radialGradient id="sg" cx="50%" cy="40%" r="70%"><stop offset="0" stop-color="${p.bg}"/><stop offset="1" stop-color="${p.secondary}"/></radialGradient></defs><rect width="${W}" height="${H}" fill="url(#sg)"/>`;
    await setBg(c, `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${bg || '<rect width="100%" height="100%" fill="#ffffff"/>'}</svg>`, W, H);
    const st0 = { comps: cv.comps.length, placed: cv.placed.length };
    let y = sr.y + sr.h * (stamp ? 0.18 : 0.08);
    y = await logo(c, cv, { x: sr.x, y, w: sr.w, h: sr.h * (stamp ? 0.3 : 0.4) }, colr) + sr.h * 0.04;
    y = await line(c, cv, 'headline', T(c, 'headline') || (c.logo ? b.business : ''), sr, y, { pt: Math.max(7, a.trim.w * 0.22), minPt: 6, weight: 'extrabold', color: stamp ? '#000' : p.ink, align: 'centre', maxH: sr.h * 0.3 });
    await line(c, cv, 'subline', T(c, 'subline') || T(c, 'phone'), sr, y, { pt: Math.max(6, a.trim.w * 0.12), minPt: 5.5, weight: 'bold', color: stamp ? '#000' : p.ink, align: 'centre', maxH: sr.y + sr.h - y });
    centreV(cv, st0, sr);
    let png = await flatten(W, H, bg, cv, transparent);
    // art outside the cut + bleed is cleared (the knife may drift inside the bleed only)
    const keep = cut === 'circle' ? circlePath(n1(cx), n1(cy), n1(a.trim.w / 2 + bl), n1(a.trim.h / 2 + bl)) : rectPath(0, 0, n1(a.trim.w + 2 * bl), n1(a.trim.h + 2 * bl), cut === 'rect' ? 0 : n1(Math.min(a.trim.w, a.trim.h) * 0.12 + bl));
    png = await sharp(png).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><path d="${scaleP(keep, k)}" fill="#fff"/></svg>`), blend: 'dest-in' }]).png().toBuffer();
    let white: Buffer | undefined;
    if (transparent) white = await sharp(png).extractChannel(3).threshold(32).toColourspace('b-w').png().toBuffer();
    const pages = [page(stamp ? (en ? 'Stamp artwork (positive)' : 'تصميم الختم (موجب)') : (en ? 'Sticker' : 'الاستيكر'), png, cv, [sr], { cut: path, white, transparentBg: transparent })];
    if (stamp) { const mir = await sharp(png).flop().png().toBuffer(); pages.push({ ...pages[0], label: en ? 'Stamp — mirrored for production' : 'الختم — معكوس لصناعة الختم', png: mir, placed: [], note: 'mirrored' }); }
    if (a.product.id === 'kisscut_sheet') {
      // A4 sheet: copies with ≥ 3 mm between kiss-cuts, a die-cut around the sheet
      const gap = 3, sw = 210, sh = 297, m = 10;
      const per = Math.max(1, Math.floor((sw - 2 * m + gap) / (a.trim.w + gap))), rows = Math.max(1, Math.floor((sh - 2 * m + gap) / (a.trim.h + gap)));
      const KW = Math.round(sw * k), KH = Math.round(sh * k); const comps: OverlayOptions[] = []; const kiss: string[] = [];
      const inner = await sharp(png).extract({ left: Math.round(bl * k), top: Math.round(bl * k), width: Math.round(a.trim.w * k), height: Math.round(a.trim.h * k) }).png().toBuffer();
      for (let r2 = 0; r2 < rows; r2++) for (let q = 0; q < per; q++) { const x = m + q * (a.trim.w + gap), y2 = m + r2 * (a.trim.h + gap); comps.push({ input: inner, left: Math.round(x * k), top: Math.round(y2 * k) }); kiss.push(cut === 'circle' ? circlePath(n1(x + a.trim.w / 2), n1(y2 + a.trim.h / 2), n1(a.trim.w / 2)) : rectPath(n1(x), n1(y2), n1(a.trim.w), n1(a.trim.h), n1(Math.min(a.trim.w, a.trim.h) * 0.12))); }
      const sheet = await sharp({ create: { width: KW, height: KH, channels: 4, background: '#ffffff' } }).composite(comps).png().toBuffer();
      pages.push({ label: en ? `Kiss-cut sheet A4 (${per * rows} pcs, ${gap} mm apart)` : `ورقة Kiss-Cut مقاس A4 (${per * rows} قطعة، المسافة ${gap} مم)`, png: sheet, widthPx: KW, heightPx: KH, dpi: inp.dpi, trimMm: { w: sw, h: sh }, bleedMm: 0, safeMm: m, safe: [], placed: [], cut: rectPath(0, 0, sw, sh), kissCut: kiss });
    }
    return pages;
  }

  if (fam === 'wrap') {
    // cylinder print area: the seam (handle) is at both ends — content stays ≥ 10 mm from it; two views so both hands see it
    const cv = new Canvas(); const seam = 10;
    const half = (a.trim.w - 2 * seam) / 2;
    const left: Rect = { x: Math.round((seam + sf * 0.5) * k), y: Math.round(sf * k), w: Math.round((half - sf) * k), h: Math.round((a.trim.h - 2 * sf) * k) };
    const right: Rect = { ...left, x: Math.round((seam + half + sf * 0.5) * k) };
    const bg = background(c, W, H, 0, left); await setBg(c, `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${bg}</svg>`, W, H);
    await composeSheet(c, cv, left, { scale: scaleFor(half, a.trim.h) * 1.5, dark: false, contacts: false, body: false, noBand: true });
    const hasHero = await image(c, cv, 'hero', right, { radius: k * 4 });
    if (!hasHero) await composeSheet(c, cv, right, { scale: scaleFor(half, a.trim.h) * 1.3, dark: false, contacts: true, body: false });
    const png = await flatten(W, H, bg, cv);
    const mirrored = await sharp(png).flop().png().toBuffer();
    return [page(en ? 'Print area (wrap)' : 'منطقة الطباعة (التفاف)', png, cv, [left, right], { hidden: [{ label: en ? 'Seam / handle' : 'منطقة المقبض/اللحام', rect: { x: 0, y: 0, w: Math.round(seam * k), h: H } }, { label: en ? 'Seam / handle' : 'منطقة المقبض/اللحام', rect: { x: W - Math.round(seam * k), y: 0, w: Math.round(seam * k), h: H } }] }),
      { ...page(en ? 'Mirrored (sublimation transfer — only if the press requires it)' : 'نسخة معكوسة للتسامي (فقط إن كان الجهاز يتطلبها)', mirrored, new Canvas(), []), note: 'mirrored' }];
  }

  if (fam === 'apparel') {
    // transparent artwork at the print-area size; white underbase on dark fabric
    const cv = new Canvas(); const sr: Rect = { x: 0, y: 0, w: W, h: H };
    await setBg(c, `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${b.conditions.darkFabric ? '#111827' : '#ffffff'}"/></svg>`, W, H);
    await composeSheet(c, cv, sr, { scale: scaleFor(a.trim.w, a.trim.h), dark: !!b.conditions.darkFabric, heroSlot: 'hero', contacts: false, body: false, noBand: true });
    const png = await flatten(W, H, '', cv, true);
    const white = b.conditions.darkFabric ? await sharp(png).extractChannel(3).threshold(32).toColourspace('b-w').png().toBuffer() : undefined;
    return [page(en ? 'Print artwork (transparent)' : 'تصميم الطباعة (خلفية شفافة)', png, cv, [sr], { transparentBg: true, white })];
  }

  // sheet · large_format · flat_gift · packaging (preview) — one composition, scaled to the product
  const pages: PrintPage[] = [];
  const big = fam === 'large_format';
  const hidden: PrintPage['hidden'] = [];
  let sr = safeR();
  if (/rollup|xbanner/.test(a.product.id)) { const base = a.product.id === 'rollup' ? 100 : 40; hidden.push({ label: en ? `Hidden in the stand base (${base} mm)` : `تختفي داخل قاعدة الستاند (${base} مم)`, rect: { x: 0, y: H - Math.round((base + bl) * k), w: W, h: Math.round((base + bl) * k) } }); sr = { ...sr, h: sr.h - Math.round((base - sf + 10) * k) }; }
  if (/pvc_banner|fabric_banner|outdoor/.test(a.product.id)) { const e = 30; hidden.push({ label: en ? 'Eyelets / hem zone' : 'منطقة العيون المعدنية/الحواف', rect: { x: B, y: B, w: W - 2 * B, h: Math.round(e * k) } }); }
  const bg = background(c, W, H, B, sr);
  await setBg(c, `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${bg}</svg>`, W, H);
  const viewM = b.viewM ?? a.product.viewM;
  // legibility from the target distance: capital height ≈ distance / 250 (≈ 4 mm per metre for a headline we want read at a glance)
  const minHeadlineMm = big && viewM ? Math.max(10, viewM * 4) : undefined;
  if (a.product.id === 'letterhead') {
    const cv = new Canvas(); await logo(c, cv, { x: sr.x, y: sr.y, w: sr.w * 0.4, h: k * 18 }, c.cc.palette.primary, 'start');
    cv.svg.push(`<rect x="${B}" y="${Math.round(sr.y + k * 22)}" width="${W - 2 * B}" height="${Math.max(1, k * 0.6)}" fill="${c.cc.palette.secondary}"/>`);
    await line(c, cv, 'contacts', contactsOf(c).join(' · '), sr, sr.y + sr.h - k * 8, { pt: 8.5, minPt: 7, color: c.cc.palette.ink, align: 'centre' });
    pages.push(page(en ? 'Letterhead' : 'الورقة الرسمية', await flatten(W, H, `<rect width="${W}" height="${H}" fill="#ffffff"/>`, cv), cv, [sr], { cut: trimCut, note: en ? 'The body area stays empty for the letter text' : 'منطقة المحتوى فارغة لنص الخطاب' }));
    return pages;
  }
  const faces = a.sides === 2 && fam === 'sheet' ? 2 : 1;
  for (let f = 0; f < faces; f++) {
    const cv = new Canvas();
    if (f === 1) await setBg(c, `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${c.cc.palette.bg}"/></svg>`, W, H);
    if (f === 0) await composeSheet(c, cv, sr, { scale: scaleFor(a.trim.w, a.trim.h) * (big ? 0.9 : 1), dark: c.cc.layout === 'band' ? false : onDark(c.cc.palette.bg), heroSlot: 'hero', minHeadlineMm });
    else { let y = sr.y; y = await line(c, cv, 'back:headline', T(c, 'headline'), sr, y, { pt: 18 * scaleFor(a.trim.w, a.trim.h), weight: 'extrabold', color: c.cc.palette.primary }) + k * 4; for (const [i, e] of c.b.texts.extra.entries()) y = await line(c, cv, `back:${i}`, `• ${e}`, sr, y, { pt: 12 * scaleFor(a.trim.w, a.trim.h), weight: 'bold', color: c.cc.palette.ink }) + k * 2; await line(c, cv, 'back:contacts', contactsOf(c).join(' · '), sr, sr.y + sr.h - k * 10, { pt: 10, color: c.cc.palette.ink, align: 'centre' }); }
    if (fam === 'packaging') cv.svg.push(`<rect x="${B}" y="${B}" width="${Math.round(k * 70)}" height="${Math.round(k * 9)}" fill="#dc2626"/>`);
    const png = await flatten(W, H, f === 0 ? bg : `<rect width="${W}" height="${H}" fill="${c.cc.palette.bg}"/>`, cv);
    const pg = page(faces === 2 ? (f === 0 ? (en ? 'Front' : 'الوجه الأمامي') : (en ? 'Back' : 'الوجه الخلفي')) : FAMILIES[fam].ar, png, cv, [sr], { cut: trimCut, hidden: hidden.length ? hidden : undefined });
    if (fam === 'packaging') { const lbl = await textImg(en ? 'PREVIEW ONLY — waiting for the supplier dieline' : 'معاينة فقط — بانتظار Dieline المورد', { pt: 9, kmm: k, w: k * 68, color: '#ffffff', weight: 'extrabold' }); pg.png = await sharp(pg.png).composite([{ input: lbl.png, left: Math.round(B + k), top: Math.round(B + k * 1.5) }]).png().toBuffer(); pg.note = 'preview_only'; }
    pages.push(pg);
  }
  void blank;
  return pages;
}

/** scales an mm path to px (arc rotation / flags are not scaled) */
export function scaleP(d: string, k: number) {
  return d.replace(/([MLHVAZC])([^MLHVAZC]*)/gi, (_m, cmd: string, args: string) => {
    const nums = args.trim() ? args.trim().split(/[\s,]+/).map(Number) : [];
    const out = nums.map((v, i) => (cmd.toUpperCase() === 'A' && [2, 3, 4].includes(i % 7) ? v : Math.round(v * k * 100) / 100));
    return `${cmd}${out.join(' ')}${out.length ? ' ' : ''}`;
  }).trim();
}
