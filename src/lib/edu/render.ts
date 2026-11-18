import sharp, { type OverlayOptions } from 'sharp';
import { escapeMarkup } from '../render/text';
import { fontFor, missingGlyphs, type Weight } from '../render/fonts';
import { storage } from '../storage';
import { PAPER_MM, PRESETS, type EduContent, type EduSettings } from './types';
import { tokenize, visualOrder, withDigits, type Token } from './math';

/**
 * Layout + rendering engine. Every page is drawn at its exact paper size in millimetres (300 DPI for files, lower for
 * the preview — the SAME code, so exported files match the preview). Arabic text is shaped by Pango (HarfBuzz +
 * FriBiDi); equations are drawn token by token so digits and + − = never flip; titles/equations are real text, never
 * text inside an AI image.
 */
export interface Rect { x: number; y: number; w: number; h: number }
export interface Placed { id: string; kind: 'text' | 'equation' | 'image' | 'box'; rect: Rect; region: string; fits: boolean; missing?: string[]; text?: string }
export interface RenderedPage { png: Buffer; widthPx: number; heightPx: number; dpi: number; trimMm: { w: number; h: number }; bleedMm: number; placed: Placed[]; regions: { id: string; label: string; rect: Rect; safe: Rect }[]; folds: number[]; label: string }
export interface RenderedDoc { pages: RenderedPage[]; engine: string; fontScale: number }

const THEMES = {
  blue: { p: '#1d4ed8', s: '#38bdf8', a: '#f59e0b', bg: '#ffffff', soft: '#eff6ff', ink: '#0f172a', mute: '#475569' },
  green: { p: '#15803d', s: '#4ade80', a: '#f97316', bg: '#ffffff', soft: '#f0fdf4', ink: '#052e16', mute: '#3f6212' },
  purple: { p: '#6d28d9', s: '#c084fc', a: '#facc15', bg: '#ffffff', soft: '#f5f3ff', ink: '#1e1b4b', mute: '#5b21b6' },
  orange: { p: '#c2410c', s: '#fb923c', a: '#0ea5e9', bg: '#ffffff', soft: '#fff7ed', ink: '#431407', mute: '#9a3412' },
  navy_gold: { p: '#0b1730', s: '#e6c25a', a: '#b8892a', bg: '#fffdf6', soft: '#fbf6e6', ink: '#0b1730', mute: '#475569' },
  pink: { p: '#be185d', s: '#f9a8d4', a: '#14b8a6', bg: '#ffffff', soft: '#fdf2f8', ink: '#500724', mute: '#9d174d' },
} as const;
type Theme = (typeof THEMES)[keyof typeof THEMES];

export function paperMm(s: EduSettings) {
  const [w, h] = s.size === 'custom' ? [s.customMm?.w ?? 210, s.customMm?.h ?? 297] : PAPER_MM[s.size];
  return s.orientation === 'landscape' ? { w: Math.max(w, h), h: Math.min(w, h) } : { w: Math.min(w, h), h: Math.max(w, h) };
}

/** Brochure panel order per side, left → right on the sheet. Logical panels: side A = [front, back, flap]; side B = [in1, in2, in3]. */
export function defaultPanelOrder(lang: EduSettings['lang']): number[][] {
  // Arabic folds open to the left: side A reads front · back · flap from left to right, the inside reads right → left
  return lang === 'en' ? [[2, 1, 0], [0, 1, 2]] : [[0, 1, 2], [2, 1, 0]];
}
/** Letter-fold check: on the outside the front cover and the inner flap must be the two END panels, the back in the middle. */
export function foldCheck(order: number[][]): { ok: boolean; note: string } {
  const a = order[0];
  const ok = a[1] === 1 && new Set([a[0], a[2]]).size === 2 && [a[0], a[2]].includes(0) && [a[0], a[2]].includes(2);
  return { ok, note: ok ? 'بعد الطي: الغلاف الأمامي في الأعلى، والغلاف الخلفي في المنتصف من الخارج' : 'بعد الطي لن يكون الغلاف الأمامي في الأعلى: يجب أن يكون الغلاف الخلفي في منتصف الوجه الخارجي، والغلاف الأمامي والطية الداخلية على الطرفين' };
}

// ───────────────────────── text primitives ─────────────────────────
interface Ctx { k: number; s: EduSettings; t: Theme; rtl: boolean; cache: Map<string, Text>; images: Record<string, string> }
interface Text { png: Buffer; w: number; h: number; fits: boolean; missing: string[] }
const pt = (c: Ctx, v: number) => Math.round(v * c.s.fontScale * (c.k * 25.4) / 72); // points → px at this DPI

async function text(c: Ctx, raw: string, o: { size: number; weight?: Weight; color?: string; w: number; align?: 'left' | 'centre' | 'right'; ltr?: boolean; maxH?: number }): Promise<Text> {
  // ligature symbols the print font does not contain are written out (never a fallback font in a print file)
  const str = withDigits(raw, c.s.digits).replace(/ﷺ/g, '(صلى الله عليه وسلم)').replace(/ﷻ/g, '(جلّ جلاله)').replace(/[✓✔]/g, '•');
  const weight = o.weight ?? 'regular', color = o.color ?? c.t.ink, size = pt(c, o.size);
  const align = o.align ?? (c.rtl ? 'right' : 'left');
  const key = `${str}|${size}|${weight}|${color}|${o.w}|${align}|${o.ltr ? 1 : 0}`;
  const hit = c.cache.get(key); if (hit) return { ...hit, fits: hit.fits && (!o.maxH || hit.h <= o.maxH) };
  if (!str.trim()) return { png: await sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer(), w: 1, h: 1, fits: true, missing: [] };
  const { fontfile, desc } = fontFor('ar', weight);
  const body = o.ltr ? `⁦${str}⁩` : str;
  // Pango mirrors left/right for a right-to-left paragraph: ask for the opposite so wrapped Arabic lines really align right
  const strong = str.match(/[A-Za-z\u0590-\u08FF]/)?.[0];
  const pangoAlign = !o.ltr && strong && /[\u0590-\u08FF]/.test(strong) && align !== 'centre' ? (align === 'right' ? 'left' : 'right') : align;
  const { data, info } = await sharp({ text: { text: `<span foreground="${color}">${escapeMarkup(body)}</span>`, font: `${desc} ${size}`, fontfile, width: Math.max(10, Math.round(o.w)), rgba: true, align: pangoAlign, wrap: 'word', dpi: 72, spacing: -Math.round(size * 0.22) } })
    .png().toBuffer({ resolveWithObject: true });
  const r = { png: data, w: info.width, h: info.height, fits: info.width <= o.w + 2, missing: missingGlyphs(str, 'ar', weight) };
  c.cache.set(key, r);
  return { ...r, fits: r.fits && (!o.maxH || r.h <= o.maxH) };
}

/** An equation drawn token by token in the chosen visual direction; blanks are answer boxes. */
async function equation(c: Ctx, tokens: Token[], o: { size: number; color?: string; w: number; answer?: string }): Promise<Text> {
  const ord = visualOrder(tokens, c.s.equationDir);
  const size = pt(c, o.size), gap = Math.round(size * 0.32);
  const parts: { png?: Buffer; w: number; h: number; box?: boolean }[] = [];
  for (const tk of ord) {
    if (tk.t === 'blank') {
      if (o.answer) { const a = await text(c, o.answer, { size: o.size, weight: 'extrabold', color: c.t.p, w: size * 6, align: 'centre', ltr: true }); parts.push({ png: a.png, w: Math.max(a.w, Math.round(size * 1.9)), h: a.h, box: true }); }
      else parts.push({ w: Math.round(size * 1.9), h: Math.round(size * 1.25), box: true });
    } else {
      const r = await text(c, tk.v, { size: o.size, weight: tk.t === 'num' ? 'bold' : 'regular', color: o.color, w: size * 8, align: 'centre', ltr: true });
      parts.push({ png: r.png, w: r.w, h: r.h });
    }
  }
  const H = Math.max(...parts.map((p) => p.h), Math.round(size * 1.3)) + 8;
  const W = parts.reduce((a, p) => a + p.w, 0) + gap * (parts.length - 1) + 8;
  const svg: string[] = []; const comps: OverlayOptions[] = [];
  let x = 4;
  for (const p of parts) {
    if (p.box) svg.push(`<rect x="${x}" y="${Math.round((H - Math.round(size * 1.25)) / 2)}" width="${p.w}" height="${Math.round(size * 1.25)}" rx="${Math.round(size * 0.18)}" fill="#ffffff" stroke="${c.t.mute}" stroke-width="${Math.max(2, Math.round(size * 0.06))}"/>`);
    if (p.png) comps.push({ input: p.png, left: x + Math.round((p.w - (p.box ? (p.w) : p.w)) / 2) + (p.box ? 0 : 0), top: Math.round((H - p.h) / 2) });
    x += p.w + gap;
  }
  const base = sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
  const png = await base.composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${svg.join('')}</svg>`) }, ...comps]).png().toBuffer();
  return { png, w: W, h: H, fits: W <= o.w + 2, missing: [] };
}

// ───────────────────────── flow layout ─────────────────────────
type Item = { id: string; render: (w: number) => Promise<{ png: Buffer; h: number; parts: Omit<Placed, 'region'>[] }> };
interface Canvas { svg: string[]; comps: OverlayOptions[]; placed: Placed[] }

/** stacks items vertically: [text blocks] with gaps; returns one transparent PNG of width w */
async function stack(c: Ctx, w: number, blocks: (Text & { id: string; kind?: Placed['kind']; text?: string; gapAfter?: number; indent?: number; boxed?: { fill: string; stroke?: string } })[]) {
  const pad = Math.round(c.k * 2.5);
  let y = 0; const comps: OverlayOptions[] = []; const parts: Omit<Placed, 'region'>[] = []; const rects: string[] = [];
  for (const b of blocks) {
    const x = b.indent ? (c.rtl ? 0 : b.indent) : 0;
    const left = c.rtl ? Math.max(0, w - (b.indent ?? 0) - b.w) : x;
    comps.push({ input: b.png, left: Math.round(left), top: Math.round(y) });
    parts.push({ id: b.id, kind: b.kind ?? 'text', rect: { x: Math.round(left), y: Math.round(y), w: b.w, h: b.h }, fits: b.fits, missing: b.missing, text: b.text });
    y += b.h + (b.gapAfter ?? pad);
  }
  const H = Math.max(1, Math.round(y));
  const png = await sharp({ create: { width: Math.max(1, Math.round(w)), height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([...(rects.length ? [{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${H}">${rects.join('')}</svg>`) }] : []), ...comps]).png().toBuffer();
  return { png, h: H, parts };
}

// ───────────────────────── «مطوية احترافية لامعة» (glossy) building blocks ─────────────────────────
const GOLD = '#e2b13c', GOLD_D = '#a87a1c', CREAM = '#fffaeb';
const isGlossy = (c: Ctx) => resolveStyle(c.s) === 'glossy';
/** headings, captions and cover lettering keep their designed size: auto-fit grows the reading text, not the ornaments */
const fixed = (c: Ctx, size: number) => (size * Math.min(c.s.fontScale, 1.05)) / c.s.fontScale;
const shade = (hex: string, f: number) => { const n = parseInt(hex.slice(1), 16); const ch = (v: number) => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f))); return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => ch(v).toString(16).padStart(2, '0')).join('')}`; };
const blank1 = () => sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
let gid = 0;
type Icon = 'book' | 'search' | 'target' | 'pin' | 'star' | 'bulb' | 'pencil' | 'heart' | 'person' | 'books' | 'calc' | 'leaf';
/** icon picked from the heading's meaning (vector — no emoji font needed in the print file) */
export function iconFor(heading: string, i: number): Icon {
  const h = heading.toLowerCase();
  if (/مفرد|كلمات|معاني|vocab|word/.test(h)) return 'search';
  if (/معنى|مفهوم|تعريف|ما هو|ما هي|meaning|what is/.test(h)) return 'book';
  if (/أفكار|أهداف|الرئيس|idea|goal|objective/.test(h)) return 'target';
  if (/معالم|أماكن|مكان|موقع|landmark|place/.test(h)) return 'pin';
  if (/نشاط|تمرين|تدرّب|تدرب|أسئلة|activity|practice|exercise/.test(h)) return 'pencil';
  if (/ملخص|تذكّر|تذكر|مهم|summary|remember/.test(h)) return 'star';
  if (/مثال|أمثلة|حل|example|solve/.test(h)) return 'calc';
  if (/طبيع|نبات|بيئة|ماء|nature|plant|water/.test(h)) return 'leaf';
  if (/حب|وطن|قيم|love|value/.test(h)) return 'heart';
  return (['bulb', 'book', 'target', 'star', 'pencil', 'leaf'] as Icon[])[i % 6];
}
/** a white medallion with a gold ring and a coloured vector icon, centred at (cx, cy) */
function medallion(cx: number, cy: number, r: number, icon: Icon, col: string, red = '#dc2626'): string {
  const u = r / 10, x = (v: number) => (cx + v * u).toFixed(1), y = (v: number) => (cy + v * u).toFixed(1), sw = (v: number) => (v * u).toFixed(1);
  const g = `m${++gid}`;
  const ring = `<defs><radialGradient id="${g}" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#eef4ff"/></radialGradient></defs><circle cx="${cx}" cy="${cy + u * 0.8}" r="${r}" fill="#000" fill-opacity="0.18"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="${GOLD}"/><circle cx="${cx}" cy="${cy}" r="${r - u * 1.1}" fill="url(#${g})"/>`;
  const paths: Record<Icon, string> = {
    book: `<path d="M${x(-6)} ${y(-3.5)} Q${x(-3)} ${y(-5)} ${x(0)} ${y(-3.5)} L${x(0)} ${y(5)} Q${x(-3)} ${y(3.5)} ${x(-6)} ${y(5)} Z" fill="#fff" stroke="${col}" stroke-width="${sw(0.9)}"/><path d="M${x(6)} ${y(-3.5)} Q${x(3)} ${y(-5)} ${x(0)} ${y(-3.5)} L${x(0)} ${y(5)} Q${x(3)} ${y(3.5)} ${x(6)} ${y(5)} Z" fill="#fff" stroke="${col}" stroke-width="${sw(0.9)}"/><path d="M${x(-4.5)} ${y(-1)} L${x(-1.5)} ${y(-1.5)} M${x(-4.5)} ${y(1)} L${x(-1.5)} ${y(0.5)} M${x(4.5)} ${y(-1)} L${x(1.5)} ${y(-1.5)} M${x(4.5)} ${y(1)} L${x(1.5)} ${y(0.5)}" stroke="${col}" stroke-opacity="0.6" stroke-width="${sw(0.6)}"/>`,
    search: `<circle cx="${x(-1)}" cy="${y(-1)}" r="${sw(4)}" fill="#dbeafe" stroke="${col}" stroke-width="${sw(1.4)}"/><path d="M${x(2)} ${y(2)} L${x(5.5)} ${y(5.5)}" stroke="${GOLD_D}" stroke-width="${sw(2.2)}" stroke-linecap="round"/><path d="M${x(-3)} ${y(-2.5)} Q${x(-2)} ${y(-4)} ${x(-0.5)} ${y(-4)}" stroke="#fff" stroke-width="${sw(0.9)}" fill="none"/>`,
    target: `<circle cx="${cx}" cy="${cy}" r="${sw(6)}" fill="${red}"/><circle cx="${cx}" cy="${cy}" r="${sw(4.3)}" fill="#fff"/><circle cx="${cx}" cy="${cy}" r="${sw(2.7)}" fill="${red}"/><circle cx="${cx}" cy="${cy}" r="${sw(1.1)}" fill="#fff"/><path d="M${x(0)} ${y(0)} L${x(6)} ${y(-6)}" stroke="${col}" stroke-width="${sw(1)}"/><path d="M${x(6)} ${y(-6)} L${x(4)} ${y(-6.5)} M${x(6)} ${y(-6)} L${x(6.5)} ${y(-4)}" stroke="${col}" stroke-width="${sw(1)}"/>`,
    pin: `<path d="M${x(0)} ${y(6.5)} C${x(-5)} ${y(1)} ${x(-5)} ${y(-1)} ${x(-5)} ${y(-2)} A${sw(5)} ${sw(5)} 0 1 1 ${x(5)} ${y(-2)} C${x(5)} ${y(-1)} ${x(5)} ${y(1)} ${x(0)} ${y(6.5)} Z" fill="${red}"/><circle cx="${cx}" cy="${y(-2)}" r="${sw(2)}" fill="#fff"/>`,
    star: `<polygon points="${star(cx, cy, r * 0.62)}" fill="${GOLD}" stroke="${GOLD_D}" stroke-width="${sw(0.6)}"/>`,
    bulb: `<circle cx="${cx}" cy="${y(-1.5)}" r="${sw(4.2)}" fill="#fde047" stroke="${GOLD_D}" stroke-width="${sw(0.7)}"/><rect x="${x(-2)}" y="${y(2.6)}" width="${sw(4)}" height="${sw(3)}" rx="${sw(0.6)}" fill="${col}"/>`,
    pencil: `<g transform="rotate(-45 ${cx} ${cy})"><rect x="${x(-1.6)}" y="${y(-6)}" width="${sw(3.2)}" height="${sw(9)}" fill="#f59e0b"/><rect x="${x(-1.6)}" y="${y(-7)}" width="${sw(3.2)}" height="${sw(1.4)}" fill="#f472b6"/><polygon points="${x(-1.6)},${y(3)} ${x(1.6)},${y(3)} ${x(0)},${y(6.5)}" fill="#fde7c4"/><polygon points="${x(-0.6)},${y(5.2)} ${x(0.6)},${y(5.2)} ${x(0)},${y(6.5)}" fill="#334155"/></g>`,
    heart: `<path d="M${x(0)} ${y(5.5)} C${x(-7)} ${y(0)} ${x(-5)} ${y(-6)} ${x(0)} ${y(-2.5)} C${x(5)} ${y(-6)} ${x(7)} ${y(0)} ${x(0)} ${y(5.5)} Z" fill="${red}"/>`,
    person: `<circle cx="${cx}" cy="${y(-2.5)}" r="${sw(2.8)}" fill="${col}"/><path d="M${x(-5)} ${y(5.5)} Q${x(-5)} ${y(0.5)} ${x(0)} ${y(0.5)} Q${x(5)} ${y(0.5)} ${x(5)} ${y(5.5)} Z" fill="${col}"/>`,
    books: `<rect x="${x(-5)}" y="${y(1.5)}" width="${sw(10)}" height="${sw(2.6)}" rx="${sw(0.5)}" fill="#dc2626"/><rect x="${x(-4.4)}" y="${y(-1.2)}" width="${sw(9)}" height="${sw(2.6)}" rx="${sw(0.5)}" fill="#16a34a"/><rect x="${x(-4.8)}" y="${y(-3.9)}" width="${sw(9.4)}" height="${sw(2.6)}" rx="${sw(0.5)}" fill="${col}"/>`,
    calc: `<rect x="${x(-4.2)}" y="${y(-5.5)}" width="${sw(8.4)}" height="${sw(11)}" rx="${sw(1)}" fill="${col}"/><rect x="${x(-3)}" y="${y(-4.3)}" width="${sw(6)}" height="${sw(2.4)}" fill="#e0f2fe"/>${[0, 1, 2].flatMap((rr) => [0, 1, 2].map((cc) => `<rect x="${x(-3 + cc * 2.2)}" y="${y(-0.9 + rr * 2.1)}" width="${sw(1.6)}" height="${sw(1.5)}" fill="#fff"/>`)).join('')}`,
    leaf: `<path d="M${x(-5)} ${y(5)} C${x(-5)} ${y(-4)} ${x(2)} ${y(-6)} ${x(6)} ${y(-6)} C${x(6)} ${y(1)} ${x(2)} ${y(5)} ${x(-5)} ${y(5)} Z" fill="#22c55e"/><path d="M${x(-5)} ${y(5)} L${x(3)} ${y(-3)}" stroke="#15803d" stroke-width="${sw(0.8)}"/>`,
  };
  return ring + paths[icon];
}
/** glossy heading pill: deep gradient, gold rim, a highlight on the top half, and the icon medallion at the reading start */
async function glossyPill(c: Ctx, w: number, label: string, icon: Icon, o: { size?: number; id: string } = { id: 'pill' }) {
  const size = o.size ?? 14.5;
  const R = Math.round(c.k * 6.2); // medallion radius
  const t = await text(c, label, { size: fixed(c, size), weight: 'extrabold', color: '#ffffff', w: Math.round(w - R * 2 - c.k * 8), align: 'centre' });
  const ph = Math.max(Math.round(t.h + c.k * 4), Math.round(R * 1.55));
  const pw = Math.min(Math.round(w - R * 0.9), Math.round(t.w + R * 2 + c.k * 10));
  const H = Math.max(R * 2 + Math.round(c.k * 1.2), ph + Math.round(c.k * 1.6));
  const px = Math.round((w - pw) / 2 + (c.rtl ? -R * 0.45 : R * 0.45)), py = Math.round((H - ph) / 2);
  const mx = c.rtl ? px + pw : px, my = H / 2 - c.k * 0.3;
  const g = `p${++gid}`, deep = shade(c.t.p, -0.35);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${H}"><defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(c.t.p, 0.12)}"/><stop offset="1" stop-color="${deep}"/></linearGradient></defs>
    <rect x="${px}" y="${py + c.k * 0.7}" width="${pw}" height="${ph}" rx="${ph / 2}" fill="#000" fill-opacity="0.16"/>
    <rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="${ph / 2}" fill="url(#${g})" stroke="${GOLD}" stroke-width="${Math.max(2, c.k * 0.55)}"/>
    <rect x="${px + ph * 0.3}" y="${py + ph * 0.1}" width="${pw - ph * 0.6}" height="${ph * 0.36}" rx="${ph * 0.18}" fill="#ffffff" fill-opacity="0.16"/>
    ${medallion(mx, my, R, icon, c.t.p)}</svg>`;
  const tx = Math.round(c.rtl ? px + (pw - R) / 2 - t.w / 2 : px + R + (pw - R) / 2 - t.w / 2);
  const png = await sharp({ create: { width: Math.round(w), height: Math.round(H), channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from(svg) }, { input: t.png, left: Math.max(0, tx), top: Math.round(py + (ph - t.h) / 2) }]).png().toBuffer();
  return { png, h: Math.round(H), parts: [{ id: o.id, kind: 'text' as const, rect: { x: Math.max(0, tx), y: Math.round(py + (ph - t.h) / 2), w: t.w, h: t.h }, fits: t.fits, missing: t.missing, text: label }] };
}
/** bullet lines with round blue gloss dots (drawn, not a font glyph) */
async function dotList(c: Ctx, w: number, lines: string[], idp: string, size = 11) {
  const d = Math.round(pt(c, size) * 0.5), gap = Math.round(d * 1.3);
  const rows = await Promise.all(lines.map((l) => text(c, l, { size, weight: 'bold', color: shade(c.t.ink, 0.05), w: w - d - gap })));
  let y = 0; const comps: OverlayOptions[] = []; const svg: string[] = []; const parts: Omit<Placed, 'region'>[] = [];
  const g = `d${++gid}`;
  for (const [i, r] of rows.entries()) {
    const tx = c.rtl ? w - d - gap - r.w : d + gap;
    const cy = y + pt(c, size) * 0.72, cx = c.rtl ? w - d / 2 : d / 2;
    svg.push(`<circle cx="${cx}" cy="${cy}" r="${d / 2}" fill="url(#${g})"/><circle cx="${cx - d * 0.15}" cy="${cy - d * 0.17}" r="${d * 0.16}" fill="#fff" fill-opacity="0.8"/>`);
    comps.push({ input: r.png, left: Math.round(tx), top: Math.round(y) });
    parts.push({ id: `${idp}:${i}`, kind: 'text', rect: { x: Math.round(tx), y: Math.round(y), w: r.w, h: r.h }, fits: r.fits, missing: r.missing, text: lines[i] });
    y += r.h + Math.round(c.k * 1.4);
  }
  const H = Math.max(1, Math.round(y - c.k * 1.4));
  const png = await sharp({ create: { width: Math.round(w), height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${H}"><defs><radialGradient id="${g}" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="${shade(c.t.p, 0.35)}"/><stop offset="1" stop-color="${shade(c.t.p, -0.25)}"/></radialGradient></defs>${svg.join('')}</svg>`) }, ...comps]).png().toBuffer();
  return { png, h: H, parts };
}
/** cream card with a gold rim and a soft shadow around rendered blocks */
async function creamCard(c: Ctx, w: number, blocks: { png: Buffer; h: number; parts: Omit<Placed, 'region'>[] }[]) {
  const pad = Math.round(c.k * 3.4), gap = Math.round(c.k * 2.2), sh = Math.round(c.k * 0.9);
  const H = blocks.reduce((a, b) => a + b.h + gap, 0) - gap + pad * 2;
  let y = pad; const comps: OverlayOptions[] = []; const parts: Omit<Placed, 'region'>[] = [];
  for (const b of blocks) { comps.push({ input: b.png, left: pad, top: y }); for (const p of b.parts) parts.push({ ...p, rect: { ...p.rect, x: p.rect.x + pad, y: p.rect.y + y } }); y += b.h + gap; }
  const rx = Math.round(c.k * 4.5), sw = Math.max(2, c.k * 0.6);
  const png = await sharp({ create: { width: Math.round(w), height: H + sh, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${H + sh}"><rect x="${sw}" y="${sw + sh}" width="${w - 2 * sw}" height="${H - 2 * sw}" rx="${rx}" fill="#7a5a12" fill-opacity="0.16"/><rect x="${sw}" y="${sw}" width="${w - 2 * sw}" height="${H - 2 * sw}" rx="${rx}" fill="${CREAM}" stroke="${GOLD}" stroke-width="${sw}"/><rect x="${sw * 2.6}" y="${sw * 2.6}" width="${w - 5.2 * sw}" height="${H - 5.2 * sw}" rx="${rx * 0.8}" fill="none" stroke="#ffffff" stroke-opacity="0.9" stroke-width="${sw * 0.6}"/></svg>`) }, ...comps]).png().toBuffer();
  return { png, h: H + sh, parts };
}
/** a styled table (e.g. «الكلمة | معناها»): coloured header cells, tinted first column, rounded frame */
async function glossyTable(c: Ctx, w: number, tb: { headers: string[]; rows: string[][] }, idp: string) {
  const n = tb.headers.length, pad = Math.round(c.k * 2), line = Math.max(1, Math.round(c.k * 0.35));
  const widths = n === 2 ? [w * 0.36, w * 0.64] : Array.from({ length: n }, () => w / n);
  const xs = widths.map((_, i) => { const before = widths.slice(0, i).reduce((a, v) => a + v, 0); return c.rtl ? w - before - widths[i] : before; });
  const headCols = ['#6d28d9', c.t.p, shade(c.t.p, -0.2), '#0e7490'];
  const all = [tb.headers, ...tb.rows.map((r) => Array.from({ length: n }, (_, i) => r[i] ?? ''))];
  const cells = await Promise.all(all.map((row, ri) => Promise.all(row.map((v, ci) => text(c, v, { size: ri === 0 ? 11.5 : 10.5, weight: ri === 0 || ci === 0 ? 'extrabold' : 'regular', color: ri === 0 ? '#ffffff' : ci === 0 ? '#3b0764' : c.t.ink, w: Math.round(widths[ci] - pad * 2), align: ri === 0 || (ci === 0 && n === 2) ? 'centre' : undefined })))));
  const hs = cells.map((r) => Math.max(...r.map((x) => x.h)) + pad * 2);
  const H = hs.reduce((a, v) => a + v, 0);
  const svg: string[] = []; const comps: OverlayOptions[] = []; const parts: Omit<Placed, 'region'>[] = [];
  const clip = `t${++gid}`;
  svg.push(`<defs><clipPath id="${clip}"><rect x="${line}" y="${line}" width="${w - 2 * line}" height="${H - 2 * line}" rx="${c.k * 3}"/></clipPath></defs><g clip-path="url(#${clip})"><rect width="${w}" height="${H}" fill="#ffffff"/>`);
  let y = 0;
  for (const [ri, row] of cells.entries()) {
    for (const [ci, cell] of row.entries()) {
      const fill = ri === 0 ? headCols[ci % headCols.length] : ci === 0 ? '#f3e8ff' : ri % 2 ? '#ffffff' : '#f8fafc';
      svg.push(`<rect x="${xs[ci]}" y="${y}" width="${widths[ci]}" height="${hs[ri]}" fill="${fill}"/>`);
      const tx = Math.round(xs[ci] + (cell.w < widths[ci] - pad * 2 && (ri === 0 || (ci === 0 && n === 2)) ? (widths[ci] - cell.w) / 2 : c.rtl ? widths[ci] - pad - cell.w : pad));
      comps.push({ input: cell.png, left: tx, top: Math.round(y + (hs[ri] - cell.h) / 2) });
      parts.push({ id: `${idp}:${ri}:${ci}`, kind: 'text', rect: { x: tx, y: Math.round(y + (hs[ri] - cell.h) / 2), w: cell.w, h: cell.h }, fits: cell.fits, missing: cell.missing, text: all[ri][ci] });
    }
    if (ri) svg.push(`<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="#cbd5e1" stroke-width="${line}"/>`);
    y += hs[ri];
  }
  for (let ci = 1; ci < n; ci++) { const xx = c.rtl ? xs[ci] + widths[ci] : xs[ci]; svg.push(`<line x1="${xx}" y1="0" x2="${xx}" y2="${H}" stroke="#cbd5e1" stroke-width="${line}"/>`); }
  svg.push(`</g><rect x="${line}" y="${line}" width="${w - 2 * line}" height="${H - 2 * line}" rx="${c.k * 3}" fill="none" stroke="${c.t.p}" stroke-width="${line * 2.4}"/>`);
  const png = await sharp({ create: { width: Math.round(w), height: Math.round(H), channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${H}">${svg.join('')}</svg>`) }, ...comps]).png().toBuffer();
  return { png, h: Math.round(H), parts };
}
/** picture grid: rounded pictures with a gold rim and a cream caption pill overlapping the bottom (2 per row) */
async function gallery(c: Ctx, w: number, items: { caption: string }[], secId: string) {
  const perRow = items.length === 1 ? 1 : 2, gap = Math.round(c.k * 3);
  const cw = Math.round((w - gap * (perRow - 1)) / perRow), ih = Math.round(cw * 0.78);
  const caps = await Promise.all(items.map((g) => text(c, g.caption, { size: fixed(c, 10.5), weight: 'extrabold', color: shade(c.t.p, -0.45), w: Math.round(cw * 0.9), align: 'centre' })));
  const capH = Math.max(...caps.map((x) => x.h)) + Math.round(c.k * 2.4);
  const cellH = ih + Math.round(capH * 0.6), rows = Math.ceil(items.length / perRow);
  const H = rows * cellH + (rows - 1) * gap;
  const svg: string[] = []; const comps: OverlayOptions[] = []; const parts: Omit<Placed, 'region'>[] = [];
  const rim = Math.max(2, Math.round(c.k * 0.7)), rx = Math.round(c.k * 3.5);
  for (const [i] of items.entries()) {
    const r = Math.floor(i / perRow), col = i % perRow;
    const x = c.rtl ? w - (col + 1) * cw - col * gap : col * (cw + gap), y = r * (cellH + gap);
    svg.push(`<rect x="${x}" y="${y + c.k * 0.8}" width="${cw}" height="${ih}" rx="${rx}" fill="#000" fill-opacity="0.15"/><rect x="${x}" y="${y}" width="${cw}" height="${ih}" rx="${rx}" fill="${GOLD}"/>`);
    const key = c.images[`gal:${secId}:${i}`];
    let placedImg = false;
    if (key) {
      try {
        const buf = await storage().get(key); const meta = await sharp(buf).metadata();
        const iw = cw - 2 * rim, ihh = ih - 2 * rim;
        const img = await sharp(buf).resize(iw, ihh, { fit: 'cover' }).png().toBuffer();
        const rounded = await sharp(img).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${iw}" height="${ihh}"><rect width="${iw}" height="${ihh}" rx="${rx - rim}" fill="#fff"/></svg>`), blend: 'dest-in' }]).png().toBuffer();
        comps.push({ input: rounded, left: Math.round(x + rim), top: Math.round(y + rim) });
        parts.push({ id: `img:gal:${secId}:${i}`, kind: 'image', rect: { x: Math.round(x + rim), y: Math.round(y + rim), w: iw, h: ihh }, fits: true, text: `${meta.width}x${meta.height}` });
        placedImg = true;
      } catch { /* drawn as a placeholder below */ }
    }
    if (!placedImg) { const g = `g${++gid}`; svg.push(`<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfdbfe"/><stop offset="1" stop-color="#eff6ff"/></linearGradient></defs><rect x="${x + rim}" y="${y + rim}" width="${cw - 2 * rim}" height="${ih - 2 * rim}" rx="${rx - rim}" fill="url(#${g})"/>${medallion(x + cw / 2, y + ih * 0.42, Math.min(cw, ih) * 0.16, 'pin', c.t.p)}`); }
    const t = caps[i], pw = Math.min(cw - c.k * 1, t.w + c.k * 8), px = x + (cw - pw) / 2, py = y + ih - capH * 0.4;
    svg.push(`<rect x="${px}" y="${py + c.k * 0.6}" width="${pw}" height="${capH}" rx="${Math.min(capH / 2, c.k * 4)}" fill="#000" fill-opacity="0.15"/><rect x="${px}" y="${py}" width="${pw}" height="${capH}" rx="${Math.min(capH / 2, c.k * 4)}" fill="${CREAM}" stroke="${GOLD}" stroke-width="${rim}"/>`);
    const tx = Math.round(x + (cw - t.w) / 2), ty = Math.round(py + (capH - t.h) / 2);
    comps.push({ input: t.png, left: tx, top: ty });
    parts.push({ id: `${secId}:gal${i}`, kind: 'text', rect: { x: tx, y: ty, w: t.w, h: t.h }, fits: t.fits, missing: t.missing, text: items[i].caption });
  }
  const png = await sharp({ create: { width: Math.round(w), height: Math.round(H), channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${H}">${svg.join('')}</svg>`) }, ...comps]).png().toBuffer();
  return { png, h: Math.round(H), parts };
}
/** the glossy items of one section: icon pill · picture · cream card (body + dotted bullets) · table · gallery · examples · exercises */
function glossySection(c: Ctx, content: EduContent, sec: EduContent['sections'][number], si: number, rest: Item[]): Item[] {
  const items: Item[] = [{ id: `${sec.id}:head`, render: (w) => glossyPill(c, w, sec.heading, iconFor(sec.heading, si), { id: `${sec.id}:head` }) }];
  const imgKey = c.images[`sec:${sec.id}`];
  if (imgKey) items.push(rest.find((x) => x.id === `${sec.id}:img`)!);
  if (sec.body.trim() || sec.bullets.length) items.push({ id: `${sec.id}:card`, render: async (w) => {
    const inner = w - Math.round(c.k * 6.8);
    const blocks: { png: Buffer; h: number; parts: Omit<Placed, 'region'>[] }[] = [];
    if (sec.body.trim()) { const b = await text(c, sec.body, { size: 11.5, weight: 'bold', color: shade(c.t.ink, 0.05), w: inner, align: 'centre' }); blocks.push(await stack(c, inner, [{ ...b, id: `${sec.id}:body`, text: sec.body }])); }
    if (sec.bullets.length) blocks.push(await dotList(c, inner, sec.bullets, `${sec.id}:b`));
    return creamCard(c, w, blocks);
  } });
  if (sec.table?.headers.length && sec.table.rows.length) items.push({ id: `${sec.id}:table`, render: (w) => glossyTable(c, w, sec.table!, `${sec.id}:tb`) });
  if (sec.gallery.length) items.push({ id: `${sec.id}:gallery`, render: (w) => gallery(c, w, sec.gallery, sec.id) });
  items.push(...rest.filter((x) => /:(ex|q)\d+$/.test(x.id)));
  void content; void blank1;
  return items;
}

function sectionItems(c: Ctx, content: EduContent, sections = content.sections, opt: { numbering?: { n: number }; showAnswers?: boolean } = {}): Item[] {
  const items: Item[] = [];
  for (const sec of sections) {
    const secNo = content.sections.indexOf(sec) + 1;
    items.push({ id: `${sec.id}:head`, render: async (w) => {
      // numbered heading: the section number in a coloured circle, then the heading
      const nt = await text(c, String(secNo), { size: 11, weight: 'extrabold', color: '#ffffff', w: Math.round(c.k * 10), align: 'centre', ltr: true });
      const D = Math.max(nt.w, nt.h) + Math.round(c.k * 2.6);
      const h = await text(c, sec.heading, { size: 15, weight: 'extrabold', color: c.t.p, w: Math.round(w - D - c.k * 3) });
      const H = Math.max(h.h, D) + Math.round(c.k * 2);
      const cx = c.rtl ? w - D / 2 : D / 2, cy = H / 2 - c.k * 0.5;
      const png = await sharp({ create: { width: Math.round(w), height: Math.round(H), channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${Math.round(H)}"><circle cx="${cx}" cy="${cy}" r="${D / 2}" fill="${c.t.a}"/><line x1="${c.rtl ? 0 : D + c.k * 3}" y1="${H - c.k * 0.6}" x2="${c.rtl ? w - D - c.k * 3 : w}" y2="${H - c.k * 0.6}" stroke="${c.t.p}" stroke-opacity="0.18" stroke-width="${Math.max(1, c.k * 0.4)}"/></svg>`) },
          { input: nt.png, left: Math.round(cx - nt.w / 2), top: Math.round(cy - nt.h / 2) },
          { input: h.png, left: c.rtl ? Math.round(w - D - c.k * 3 - h.w) : Math.round(D + c.k * 3), top: Math.round(cy - h.h / 2) }]).png().toBuffer();
      return { png, h: Math.round(H), parts: [{ id: `${sec.id}:head`, kind: 'text', rect: { x: 0, y: 0, w: Math.round(w), h: Math.round(H) }, fits: h.fits, missing: h.missing, text: sec.heading }] };
    } });
    const imgKey = c.images[`sec:${sec.id}`];
    if (imgKey) items.push({ id: `${sec.id}:img`, render: async (w) => {
      // the section's AI illustration (no text inside it), rounded, 2:1
      try {
        const buf = await storage().get(imgKey); const meta = await sharp(buf).metadata();
        // brochure panels are narrow (2:1 picture); posters/worksheets use a wide 3:1 band so a page holds every part
        const iw = Math.round(w), ih = Math.round(w * (PRESETS[c.s.type].engine === 'panels' ? 0.5 : 0.33));
        const img = await sharp(buf).resize(iw, ih, { fit: 'cover' }).png().toBuffer();
        const png = await sharp(img).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${iw}" height="${ih}"><rect width="${iw}" height="${ih}" rx="${Math.round(c.k * 3)}" fill="#fff"/></svg>`), blend: 'dest-in' }]).png().toBuffer();
        return { png, h: ih, parts: [{ id: `img:sec:${sec.id}`, kind: 'image' as const, rect: { x: 0, y: 0, w: iw, h: ih }, fits: true, text: `${meta.width}x${meta.height}` }] };
      } catch { return { png: await sharp({ create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer(), h: 1, parts: [] }; }
    } });
    if (sec.body.trim()) items.push({ id: `${sec.id}:body`, render: async (w) => { const b = await text(c, sec.body, { size: 11, w }); return stack(c, w, [{ ...b, id: `${sec.id}:body`, text: sec.body }]); } });
    if (sec.bullets.length) items.push({ id: `${sec.id}:bullets`, render: async (w) => stack(c, w, await Promise.all(sec.bullets.map(async (b, i) => ({ ...(await text(c, `• ${b}`, { size: 11, w })), id: `${sec.id}:b${i}`, text: b, gapAfter: Math.round(c.k * 1.2) })))) });
    for (const [i, ex] of sec.examples.entries()) items.push({ id: `${sec.id}:ex${i}`, render: async (w) => {
      const inner = w - Math.round(c.k * 6);
      const tk = tokenize(ex.problem);
      const head = tk ? await equation(c, tk, { size: 13, w: inner }) : await text(c, ex.problem, { size: 12, weight: 'bold', w: inner });
      const steps = await Promise.all(ex.steps.map((st) => text(c, `– ${st}`, { size: 10, color: c.t.mute, w: inner })));
      const ans = ex.answer && !tk ? await text(c, `${c.s.lang === 'en' ? 'Answer' : 'الإجابة'}: ${ex.answer}`, { size: 11, weight: 'bold', color: c.t.p, w: inner }) : null;
      const st = await stack(c, inner, [{ ...head, id: `${sec.id}:ex${i}`, kind: tk ? 'equation' : 'text', text: ex.problem }, ...steps.map((s2, j) => ({ ...s2, id: `${sec.id}:ex${i}:st${j}`, text: ex.steps[j], gapAfter: Math.round(c.k * 1) })), ...(ans ? [{ ...ans, id: `${sec.id}:ex${i}:ans`, text: ex.answer }] : [])]);
      const pad = Math.round(c.k * 3), H = st.h + pad * 2;
      const png = await sharp({ create: { width: Math.round(w), height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${H}"><rect x="1" y="1" width="${w - 2}" height="${H - 2}" rx="${Math.round(c.k * 2.5)}" fill="${c.t.soft}" stroke="${c.t.s}" stroke-width="${Math.max(2, Math.round(c.k * 0.35))}"/></svg>`) }, { input: st.png, left: pad, top: pad }]).png().toBuffer();
      return { png, h: H, parts: st.parts.map((p) => ({ ...p, rect: { ...p.rect, x: p.rect.x + pad, y: p.rect.y + pad } })) };
    } });
    for (const [i, ex] of sec.exercises.entries()) items.push({ id: `${sec.id}:q${i}`, render: async (w) => {
      const n = opt.numbering ? ++opt.numbering.n : i + 1;
      // the number sits in a coloured circle — no bracket that bidi could mirror
      const nt = await text(c, String(n), { size: 10.5, weight: 'extrabold', color: '#ffffff', w: Math.round(c.k * 10), align: 'centre', ltr: true });
      const D = Math.max(nt.w, nt.h) + Math.round(c.k * 2.4);
      const num: Text = { png: await sharp({ create: { width: D, height: D, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${D}" height="${D}"><circle cx="${D / 2}" cy="${D / 2}" r="${D / 2 - 1}" fill="${c.t.p}"/></svg>`) }, { input: nt.png, left: Math.round((D - nt.w) / 2), top: Math.round((D - nt.h) / 2) }]).png().toBuffer(), w: D, h: D, fits: nt.fits, missing: nt.missing };
      const inner = w - num.w - Math.round(c.k * 3);
      const tk = ex.kind === 'equation' || tokenize(ex.q) ? tokenize(ex.q) : null;
      let body: Text;
      if (tk) body = await equation(c, tk, { size: 14, w: inner, answer: opt.showAnswers ? ex.answer : undefined });
      else {
        const qq = await text(c, ex.q + (ex.choices.length ? `\n${ex.choices.map((ch, j) => `${c.s.lang === 'en' ? 'abcd'[j] : 'أبجد'[j]}- ${ch}`).join('      ')}` : ''), { size: 12, w: inner });
        const lineH = Math.round(c.k * 9);
        const ansT = opt.showAnswers && ex.answer ? await text(c, ex.answer, { size: 11, weight: 'bold', color: c.t.p, w: inner }) : null;
        const H = qq.h + lineH + (ansT ? ansT.h : 0);
        const png = await sharp({ create: { width: Math.round(inner), height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
          .composite([{ input: qq.png, left: c.rtl ? Math.round(inner - qq.w) : 0, top: 0 }, ...(ansT ? [{ input: ansT.png, left: c.rtl ? Math.round(inner - ansT.w) : 0, top: qq.h }] : []),
            { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${inner}" height="${H}"><line x1="0" y1="${H - Math.round(c.k * 1.5)}" x2="${inner}" y2="${H - Math.round(c.k * 1.5)}" stroke="${c.t.mute}" stroke-width="2" stroke-dasharray="${Math.round(c.k * 1.5)} ${Math.round(c.k)}"/></svg>`) }]).png().toBuffer();
        body = { png, w: Math.round(inner), h: H, fits: qq.fits, missing: qq.missing };
      }
      const H = Math.max(num.h, body.h) + Math.round(c.k * 2);
      const bx = c.rtl ? Math.round(w - num.w - Math.round(c.k * 3) - body.w) : num.w + Math.round(c.k * 3);
      const png = await sharp({ create: { width: Math.round(w), height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: num.png, left: c.rtl ? Math.round(w - num.w) : 0, top: 0 }, { input: body.png, left: Math.max(0, bx), top: 0 }]).png().toBuffer();
      return { png, h: H, parts: [{ id: `${sec.id}:q${i}`, kind: tk ? 'equation' : 'text', rect: { x: Math.max(0, bx), y: 0, w: body.w, h: body.h }, fits: body.fits && num.fits, missing: body.missing, text: ex.q }] };
    } });
  }
  if (isGlossy(c)) return sections.flatMap((sec) => glossySection(c, content, sec, content.sections.indexOf(sec), items.filter((x) => x.id.startsWith(`${sec.id}:`))));
  return items;
}

/** Poster sections as cards (heading stripe + body), each card one flow unit so columns balance. */
function sectionCards(c: Ctx, content: EduContent): Item[] {
  return content.sections.map((sec, si) => ({ id: `${sec.id}:card`, render: async (w: number) => {
    const pad = Math.round(c.k * 3.5), inner = w - pad * 2;
    const parts: { png: Buffer; h: number; parts: Omit<Placed, 'region'>[] }[] = [];
    for (const it of sectionItems(c, content, [sec])) parts.push(await it.render(inner));
    const gap = Math.round(c.k * 2);
    const H = parts.reduce((a, p) => a + p.h + gap, 0) - gap + pad * 2 + Math.round(c.k * 1.5);
    const accent = [c.t.p, c.t.a, c.t.s][si % 3];
    let y = pad + Math.round(c.k * 1.5); const comps: OverlayOptions[] = []; const placed: Omit<Placed, 'region'>[] = [];
    for (const p of parts) { comps.push({ input: p.png, left: pad, top: y }); for (const q of p.parts) placed.push({ ...q, rect: { ...q.rect, x: q.rect.x + pad, y: q.rect.y + y } }); y += p.h + gap; }
    const png = await sharp({ create: { width: Math.round(w), height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${H}"><rect x="1" y="1" width="${w - 2}" height="${H - 2}" rx="${Math.round(c.k * 4)}" fill="${c.t.soft}" stroke="${accent}" stroke-opacity="0.5" stroke-width="2"/><rect x="1" y="1" width="${w - 2}" height="${Math.round(c.k * 1.5)}" rx="${Math.round(c.k * 0.7)}" fill="${accent}"/></svg>`) }, ...comps]).png().toBuffer();
    return { png, h: H, parts: placed };
  } }));
}

function listItem(c: Ctx, id: string, title: string, lines: string[], boxed = true): Item {
  if (isGlossy(c)) return { id, render: async (w) => {
    const pill = await glossyPill(c, w, title, id === 'objectives' ? 'target' : id === 'summary' ? 'star' : 'pencil', { id: `${id}:t` });
    const card = await creamCard(c, w, [await dotList(c, w - Math.round(c.k * 6.8), lines, id, 10.5)]);
    const gap = Math.round(c.k * 1.5), H = pill.h + gap + card.h;
    const png = await sharp({ create: { width: Math.round(w), height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: pill.png, left: 0, top: 0 }, { input: card.png, left: 0, top: pill.h + gap }]).png().toBuffer();
    return { png, h: H, parts: [...pill.parts, ...card.parts.map((p) => ({ ...p, rect: { ...p.rect, y: p.rect.y + pill.h + gap } }))] };
  } };
  return { id, render: async (w) => {
    const pad = boxed ? Math.round(c.k * 3) : 0, inner = w - pad * 2;
    const t = await text(c, title, { size: 13, weight: 'extrabold', color: c.t.p, w: inner });
    const ls = await Promise.all(lines.map((l) => text(c, `• ${l}`, { size: 10.5, w: inner })));
    const st = await stack(c, inner, [{ ...t, id: `${id}:t`, text: title }, ...ls.map((l, i) => ({ ...l, id: `${id}:${i}`, text: lines[i], gapAfter: Math.round(c.k * 1) }))]);
    const H = st.h + pad * 2;
    const png = await sharp({ create: { width: Math.round(w), height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([...(boxed ? [{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${H}"><rect x="1" y="1" width="${w - 2}" height="${H - 2}" rx="${Math.round(c.k * 3)}" fill="${c.t.soft}" stroke="${c.t.p}" stroke-opacity="0.35" stroke-width="2"/></svg>`) }] : []), { input: st.png, left: pad, top: pad }]).png().toBuffer();
    return { png, h: H, parts: st.parts.map((p) => ({ ...p, rect: { ...p.rect, x: p.rect.x + pad, y: p.rect.y + pad } })) };
  } };
}

function introItem(c: Ctx, content: EduContent): Item {
  return { id: 'intro', render: async (w) => {
    if (!isGlossy(c)) { const t = await text(c, content.intro, { size: 11.5, w }); return stack(c, w, [{ ...t, id: 'intro', text: content.intro }]); }
    const inner = w - Math.round(c.k * 6.8);
    const t = await text(c, content.intro, { size: 11.5, weight: 'bold', color: shade(c.t.ink, 0.05), w: inner, align: 'centre' });
    return creamCard(c, w, [await stack(c, inner, [{ ...t, id: 'intro', text: content.intro }])]);
  } };
}

/** Places items into columns (in reading order); returns what did not fit. */
async function flow(c: Ctx, cv: Canvas, items: Item[], cols: { id: string; rect: Rect }[], opts: { balance?: boolean; spread?: boolean } = {}): Promise<Item[]> {
  if (opts.spread && cols.length === 1 && items.length) { const left = await spreadOnce(c, cv, items, cols[0]); if (left) return []; }
  if (opts.balance) {
    // balanced breaks must never cost a page: if they leave something over, undo and fill the columns in order
    const mark = { comps: cv.comps.length, placed: cv.placed.length };
    const left = await flowOnce(c, cv, items, cols, true);
    if (!left.length) return left;
    cv.comps.length = mark.comps; cv.placed.length = mark.placed;
  }
  return flowOnce(c, cv, items, cols, false);
}

/** one panel whose content fits: distribute the free height between the items (a filled, calm panel instead of a gap at the bottom) */
async function spreadOnce(c: Ctx, cv: Canvas, items: Item[], col: { id: string; rect: Rect }): Promise<boolean> {
  const rs = []; for (const it of items) rs.push(await it.render(col.rect.w));
  const base = Math.round(c.k * 3), total = rs.reduce((a, r) => a + r.h, 0);
  if (total + base * (rs.length - 1) > col.rect.h) return false;
  // the free height goes BETWEEN sections (a heading stays close to its card)
  const group = (id: string) => id.split(':')[0];
  const breaks = items.slice(1).filter((it, i) => group(it.id) !== group(items[i].id)).length;
  const inner = (rs.length - 1 - breaks) * base;
  const gap = breaks ? Math.min(c.k * 14, (col.rect.h - total - inner) / breaks) : base;
  let y = col.rect.y + Math.min(c.k * 6, Math.max(0, (col.rect.h - total - inner - gap * breaks) / 2));
  for (const [i, r] of rs.entries()) {
    if (i) y += group(items[i].id) !== group(items[i - 1].id) ? gap : base;
    cv.comps.push({ input: r.png, left: Math.round(col.rect.x), top: Math.round(y) });
    for (const p of r.parts) cv.placed.push({ ...p, region: col.id, fits: p.fits, rect: { x: p.rect.x + col.rect.x, y: p.rect.y + Math.round(y), w: p.rect.w, h: p.rect.h } });
    y += r.h;
  }
  return true;
}

async function flowOnce(c: Ctx, cv: Canvas, items: Item[], cols: { id: string; rect: Rect }[], balance: boolean): Promise<Item[]> {
  const opts = { balance };
  const gap = Math.round(c.k * 3);
  // balanced columns: measure everything once, then break so columns end at about the same height (reading order kept)
  let target = Infinity;
  const pre = new Map<number, Awaited<ReturnType<Item['render']>>>();
  if (opts.balance && cols.length > 1 && cols.every((x) => Math.abs(x.rect.w - cols[0].rect.w) < 2)) {
    let total = 0;
    for (let i = 0; i < items.length; i++) { const r = await items[i].render(cols[0].rect.w); pre.set(i, r); total += r.h + gap; }
    const capacity = cols[0].rect.h;
    if (total <= capacity * cols.length) target = Math.max(total / cols.length, Math.max(...[...pre.values()].map((r) => r.h)));
  }
  let ci = 0, y = cols[0]?.rect.y ?? 0, inCol = 0;
  for (let i = 0; i < items.length; i++) {
    const col = cols[ci]; if (!col) return items.slice(i);
    const r = pre.get(i) ?? await items[i].render(col.rect.w);
    const used = y - col.rect.y;
    const tooTall = y + r.h > col.rect.y + col.rect.h && y > col.rect.y;
    const pastTarget = inCol > 0 && ci < cols.length - 1 && used + r.h / 2 > target;
    if (tooTall || pastTarget) { ci++; i--; inCol = 0; y = cols[ci]?.rect.y ?? 0; if (!cols[ci]) return items.slice(i + 1); continue; }
    const fits = y + r.h <= col.rect.y + col.rect.h;
    cv.comps.push({ input: r.png, left: Math.round(col.rect.x), top: Math.round(y) });
    for (const p of r.parts) cv.placed.push({ ...p, region: col.id, fits: p.fits && fits, rect: { x: p.rect.x + col.rect.x, y: p.rect.y + y, w: p.rect.w, h: p.rect.h } });
    y += r.h + gap; inCol++;
  }
  return [];
}

async function placeImage(c: Ctx, cv: Canvas, slot: string, rect: Rect, region: string) {
  const key = c.images[slot]; if (!key) return false;
  try {
    const buf = await storage().get(key);
    const img = await sharp(buf).resize(Math.round(rect.w), Math.round(rect.h), { fit: 'cover' }).png().toBuffer();
    const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(rect.w)}" height="${Math.round(rect.h)}"><rect width="${Math.round(rect.w)}" height="${Math.round(rect.h)}" rx="${Math.round(c.k * 4)}" fill="#fff"/></svg>`);
    const rounded = await sharp(img).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
    cv.comps.push({ input: rounded, left: Math.round(rect.x), top: Math.round(rect.y) });
    const meta = await sharp(buf).metadata();
    cv.placed.push({ id: `img:${slot}`, kind: 'image', rect, region, fits: true, text: `${meta.width}x${meta.height}` });
    return true;
  } catch { return false; }
}

// ───────────────────────── engines ─────────────────────────
interface PageDraft { label: string; regions: { id: string; label: string; rect: Rect; safe: Rect }[]; folds: number[]; cv: Canvas }
const newPage = (label: string): PageDraft => ({ label, regions: [], folds: [], cv: { svg: [], comps: [], placed: [] } });

async function headerBand(c: Ctx, cv: Canvas, content: EduContent, r: Rect, region: string, big = 26) {
  if (isGlossy(c)) { const g = `hb${++gid}`, sw = Math.max(2, c.k * 0.9); cv.svg.push(`<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(c.t.p, 0.1)}"/><stop offset="1" stop-color="${shade(c.t.p, -0.4)}"/></linearGradient></defs><rect x="${r.x}" y="${r.y + c.k}" width="${r.w}" height="${r.h}" rx="${c.k * 7}" fill="#000" fill-opacity="0.18"/><rect x="${r.x + sw / 2}" y="${r.y + sw / 2}" width="${r.w - sw}" height="${r.h - sw}" rx="${c.k * 7}" fill="url(#${g})" stroke="${GOLD}" stroke-width="${sw}"/><rect x="${r.x + c.k * 6}" y="${r.y + r.h * 0.08}" width="${r.w - c.k * 12}" height="${r.h * 0.32}" rx="${r.h * 0.16}" fill="#fff" fill-opacity="0.13"/>`); }
  else cv.svg.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${Math.round(c.k * 5)}" fill="${c.t.p}"/><rect x="${r.x}" y="${r.y + r.h - Math.round(c.k * 1.6)}" width="${r.w}" height="${Math.round(c.k * 1.6)}" fill="${c.t.a}"/>`);
  const pad = Math.round(c.k * 6);
  const t = await text(c, content.title, { size: big, weight: 'extrabold', color: '#ffffff', w: r.w - pad * 2, align: 'centre' });
  const st = content.subtitle ? await text(c, content.subtitle, { size: 12, color: '#ffffff', w: r.w - pad * 2, align: 'centre' }) : null;
  const total = t.h + (st ? st.h + c.k * 2 : 0);
  const y0 = r.y + Math.max(pad / 2, (r.h - total) / 2);
  cv.comps.push({ input: t.png, left: Math.round(r.x + (r.w - t.w) / 2), top: Math.round(y0) });
  cv.placed.push({ id: 'title', kind: 'text', rect: { x: Math.round(r.x + (r.w - t.w) / 2), y: Math.round(y0), w: t.w, h: t.h }, region, fits: t.fits && total <= r.h, missing: t.missing, text: content.title });
  if (st) { cv.comps.push({ input: st.png, left: Math.round(r.x + (r.w - st.w) / 2), top: Math.round(y0 + t.h + c.k * 2) }); cv.placed.push({ id: 'subtitle', kind: 'text', rect: { x: Math.round(r.x + (r.w - st.w) / 2), y: Math.round(y0 + t.h + c.k * 2), w: st.w, h: st.h }, region, fits: st.fits, text: content.subtitle }); }
}

async function infoLines(c: Ctx, cv: Canvas, r: Rect, region: string, withBlanks: boolean) {
  const s = c.s, en = s.lang === 'en';
  const fields: [string, string][] = [[en ? 'Name' : 'الاسم', s.student], [en ? 'Class' : 'الصف', s.classSection || (s.student ? s.grade : '')], [en ? 'School' : 'المدرسة', s.school]];
  const show = fields.filter(([, v]) => v || withBlanks);
  if (!show.length) return;
  const colW = r.w / show.length;
  for (const [i, [label, v]] of show.entries()) {
    const t = await text(c, `${label}: ${v || '……………………'}`, { size: 11, weight: 'bold', color: c.t.ink, w: Math.round(colW - c.k * 3), align: 'centre' });
    const x = c.rtl ? r.x + r.w - colW * (i + 1) : r.x + colW * i;
    cv.comps.push({ input: t.png, left: Math.round(x + (colW - t.w) / 2), top: Math.round(r.y) });
    cv.placed.push({ id: `info:${i}`, kind: 'text', rect: { x: Math.round(x + (colW - t.w) / 2), y: Math.round(r.y), w: t.w, h: t.h }, region, fits: t.fits && t.h <= r.h, text: `${label}: ${v}` });
  }
}

async function subjectBadge(c: Ctx, cv: Canvas, r: Rect, region: string) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, R = Math.min(r.w, r.h) * 0.42;
  cv.svg.push(`<circle cx="${cx}" cy="${cy}" r="${R}" fill="${c.t.s}" fill-opacity="0.22"/><circle cx="${cx}" cy="${cy}" r="${R * 0.74}" fill="#ffffff" stroke="${c.t.p}" stroke-width="${c.k * 1.2}"/>`);
  const t = await text(c, `${c.s.subject}\n${c.s.grade}`, { size: Math.min(15, (R * 0.32 * 72) / (c.k * 25.4)) / c.s.fontScale, weight: 'extrabold', color: c.t.p, w: Math.round(R * 1.25), align: 'centre', maxH: R * 1.3 });
  cv.comps.push({ input: t.png, left: Math.round(cx - t.w / 2), top: Math.round(cy - t.h / 2) });
  cv.placed.push({ id: 'badge', kind: 'text', rect: { x: Math.round(cx - t.w / 2), y: Math.round(cy - t.h / 2), w: t.w, h: t.h }, region, fits: t.fits, missing: t.missing, text: c.s.subject });
}

/** «الاسم / الصف / المدرسة» — filled with what was entered, otherwise a line to write on (never an invented name). */
async function nameLines(c: Ctx, cv: Canvas, r: Rect, region: string) {
  const en = c.s.lang === 'en';
  const rows: [string, string][] = [[en ? 'Prepared by' : 'إعداد الطالب/ة', c.s.student], [en ? 'Class' : 'الصف', c.s.classSection], [en ? 'School' : 'المدرسة', c.s.school]];
  let y = r.y;
  for (const [i, [l, v]] of rows.entries()) {
    const t = await text(c, `${l}: ${v || '…………………………'}`, { size: 10.5, weight: 'bold', color: c.t.ink, w: r.w });
    cv.comps.push({ input: t.png, left: Math.round(c.rtl ? r.x + r.w - t.w : r.x), top: Math.round(y) });
    cv.placed.push({ id: `name:${i}`, kind: 'text', rect: { x: Math.round(c.rtl ? r.x + r.w - t.w : r.x), y: Math.round(y), w: t.w, h: t.h }, region, fits: t.fits && y + t.h <= r.y + r.h, text: v });
    y += t.h + c.k * 1.5;
  }
}


/** glossy front cover: subject cloud · «درس» tag · title in a cream frame · the cover painting · name / class fields */
async function glossyCover(c: Ctx, cv: Canvas, content: EduContent, f: { rect: Rect; safe: Rect }) {
  const S = f.safe, en = c.s.lang === 'en', sw = Math.max(2, c.k * 0.8), deep = shade(c.t.p, -0.4);
  let y = S.y;
  // 1) subject «cloud» band
  const subj = await text(c, `${en ? 'Subject' : 'مادة'} ${c.s.subject}`, { size: fixed(c, 15), weight: 'extrabold', color: '#ffffff', w: Math.round(S.w * 0.86), align: 'centre' });
  const sh = subj.h + c.k * 6, g1 = `cv${++gid}`;
  cv.svg.push(`<defs><linearGradient id="${g1}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(c.t.p, 0.1)}"/><stop offset="1" stop-color="${deep}"/></linearGradient></defs><rect x="${S.x}" y="${y + c.k}" width="${S.w}" height="${sh}" rx="${sh / 2}" fill="#000" fill-opacity="0.18"/><rect x="${S.x + sw / 2}" y="${y}" width="${S.w - sw}" height="${sh}" rx="${sh / 2}" fill="url(#${g1})" stroke="${GOLD}" stroke-width="${sw * 1.4}"/><rect x="${S.x + sh * 0.4}" y="${y + sh * 0.1}" width="${S.w - sh * 0.8}" height="${sh * 0.33}" rx="${sh * 0.16}" fill="#fff" fill-opacity="0.14"/>`);
  cv.comps.push({ input: subj.png, left: Math.round(S.x + (S.w - subj.w) / 2), top: Math.round(y + (sh - subj.h) / 2) });
  cv.placed.push({ id: 'subject', kind: 'text', rect: { x: Math.round(S.x + (S.w - subj.w) / 2), y: Math.round(y + (sh - subj.h) / 2), w: subj.w, h: subj.h }, region: 'front', fits: subj.fits, missing: subj.missing, text: c.s.subject });
  y += sh + c.k * 6;
  // 2) title frame with the «درس» tag on its top edge
  const tag = await text(c, en ? 'Lesson' : 'درس', { size: fixed(c, 11), weight: 'extrabold', color: '#ffffff', w: Math.round(S.w * 0.5), align: 'centre' });
  let size = fixed(c, 32), tt = await text(c, content.title, { size, weight: 'extrabold', color: '#9f1239', w: Math.round(S.w * 0.82), align: 'centre' });
  while (size > fixed(c, 16) && (tt.h > S.h * 0.17 || !tt.fits)) { size -= 3; tt = await text(c, content.title, { size, weight: 'extrabold', color: '#9f1239', w: Math.round(S.w * 0.82), align: 'centre' }); }
  const fh = tt.h + c.k * 9, th = tag.h + c.k * 2.4, tw = tag.w + c.k * 10;
  cv.svg.push(`<rect x="${S.x + c.k * 2}" y="${y + c.k * 1.2}" width="${S.w - c.k * 4}" height="${fh}" rx="${c.k * 8}" fill="#000" fill-opacity="0.16"/><rect x="${S.x + c.k * 2}" y="${y}" width="${S.w - c.k * 4}" height="${fh}" rx="${c.k * 8}" fill="${CREAM}" stroke="${GOLD}" stroke-width="${sw * 2}"/><rect x="${S.x + c.k * 3.6}" y="${y + c.k * 1.6}" width="${S.w - c.k * 7.2}" height="${fh - c.k * 3.2}" rx="${c.k * 6.5}" fill="none" stroke="${GOLD_D}" stroke-opacity="0.5" stroke-width="${sw * 0.6}"/>`);
  cv.svg.push(`<rect x="${S.x + (S.w - tw) / 2}" y="${y - th / 2}" width="${tw}" height="${th}" rx="${th / 2}" fill="${c.t.p}" stroke="${GOLD}" stroke-width="${sw}"/>`);
  cv.comps.push({ input: tag.png, left: Math.round(S.x + (S.w - tag.w) / 2), top: Math.round(y - tag.h / 2) });
  cv.placed.push({ id: 'lesson_tag', kind: 'text', rect: { x: Math.round(S.x + (S.w - tag.w) / 2), y: Math.round(y - tag.h / 2), w: tag.w, h: tag.h }, region: 'front', fits: tag.fits, text: 'درس' });
  const tyy = Math.round(y + (fh - tt.h) / 2 + c.k * 0.8);
  cv.comps.push({ input: tt.png, left: Math.round(S.x + (S.w - tt.w) / 2), top: tyy });
  cv.placed.push({ id: 'title', kind: 'text', rect: { x: Math.round(S.x + (S.w - tt.w) / 2), y: tyy, w: tt.w, h: tt.h }, region: 'front', fits: tt.fits, missing: tt.missing, text: content.title });
  y += fh + c.k * 4;
  // 3) fields at the bottom (filled only with what was typed — never an invented name)
  const fields: [string, string, Icon][] = [[en ? 'Student name:' : 'اسم الطالب:', c.s.student, 'person'], [en ? 'Class:' : 'الصف:', c.s.classSection || c.s.grade, 'books']];
  if (c.s.school) fields.push([en ? 'School:' : 'المدرسة:', c.s.school, 'book']);
  const R = c.k * 5.2, boxes: { l: Text; v: Text; icon: Icon }[] = [];
  for (const [l, v, icon] of fields) boxes.push({ l: await text(c, l, { size: fixed(c, 10.5), weight: 'extrabold', color: '#9f1239', w: Math.round(S.w - R * 2 - c.k * 10) }), v: await text(c, v || '……………………', { size: fixed(c, 12), weight: 'extrabold', color: deep, w: Math.round(S.w - R * 2 - c.k * 10) }), icon });
  const bh = boxes.map((b) => Math.max(b.l.h + b.v.h + c.k * 3.5, R * 2 + c.k * 2)), gap = c.k * 2.6;
  const fieldsH = bh.reduce((a, v) => a + v + gap, 0) - gap;
  let fy = S.y + S.h - fieldsH;
  // 4) the cover painting fills the space between the title and the fields
  const art = { x: S.x, y, w: S.w, h: Math.max(c.k * 20, fy - c.k * 4 - y) };
  cv.svg.push(`<rect x="${art.x}" y="${art.y + c.k}" width="${art.w}" height="${art.h}" rx="${c.k * 5}" fill="#000" fill-opacity="0.15"/><rect x="${art.x - sw}" y="${art.y - sw}" width="${art.w + 2 * sw}" height="${art.h + 2 * sw}" rx="${c.k * 5 + sw}" fill="${GOLD}"/>`);
  if (!(await placeImage(c, cv, 'cover', art, 'front'))) { const g = `ca${++gid}`; cv.svg.push(`<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfdbfe"/><stop offset="1" stop-color="#f0f9ff"/></linearGradient></defs><rect x="${art.x}" y="${art.y}" width="${art.w}" height="${art.h}" rx="${c.k * 4}" fill="url(#${g})"/>`); await subjectBadge(c, cv, art, 'front'); }
  for (const [i, b] of boxes.entries()) {
    const h = bh[i];
    cv.svg.push(`<rect x="${S.x}" y="${fy + c.k}" width="${S.w}" height="${h}" rx="${c.k * 5}" fill="#000" fill-opacity="0.14"/><rect x="${S.x + sw / 2}" y="${fy}" width="${S.w - sw}" height="${h}" rx="${c.k * 5}" fill="${CREAM}" stroke="${GOLD}" stroke-width="${sw * 1.4}"/>`);
    const mx = c.rtl ? S.x + c.k * 3 + R : S.x + S.w - c.k * 3 - R;
    cv.svg.push(`<circle cx="${mx}" cy="${fy + h / 2}" r="${R}" fill="#e0ecff"/>`);
    cv.svg.push(medallion(mx, fy + h / 2, R * 0.92, b.icon, c.t.p));
    const tx = (tb: Text) => Math.round(c.rtl ? S.x + S.w - c.k * 5 - tb.w : S.x + c.k * 5);
    const ly = Math.round(fy + (h - b.l.h - b.v.h - c.k) / 2);
    cv.comps.push({ input: b.l.png, left: tx(b.l), top: ly }, { input: b.v.png, left: tx(b.v), top: Math.round(ly + b.l.h + c.k) });
    const nx = Math.min(tx(b.l), tx(b.v)), nr = Math.max(tx(b.l) + b.l.w, tx(b.v) + b.v.w);
    cv.placed.push({ id: `name:${i}`, kind: 'text', rect: { x: nx, y: ly, w: nr - nx, h: b.l.h + b.v.h + c.k }, region: 'front', fits: b.l.fits && b.v.fits, text: fields[i][1] });
    fy += h + gap;
  }
}

async function panelsEngine(c: Ctx, content: EduContent, W: number, H: number, b: number): Promise<PageDraft[]> {
  const order = c.s.panelOrder ?? defaultPanelOrder(c.s.lang);
  const pw = (W - 2 * b) / 3, gutter = c.k * 6, m = c.k * c.s.marginMm;
  const panelRect = (pos: number) => ({ x: b + pos * pw, y: b, w: pw, h: H - 2 * b });
  const safeRect = (pos: number) => { const r = panelRect(pos); const l = pos === 0 ? m : gutter, rr = pos === 2 ? m : gutter; return { x: r.x + l, y: r.y + m, w: r.w - l - rr, h: r.h - 2 * m }; };
  const names = [['front', 'back', 'flap'], ['in1', 'in2', 'in3']];
  const labels: Record<string, string> = { front: 'الغلاف الأمامي', back: 'الغلاف الخلفي', flap: 'الطية الداخلية', in1: 'الداخل ١', in2: 'الداخل ٢', in3: 'الداخل ٣' };
  const pages: PageDraft[] = [];
  for (let side = 0; side < 2; side++) {
    const pg = newPage(side === 0 ? (c.s.lang === 'en' ? 'Side A (outside)' : 'الوجه الأول (الخارجي)') : (c.s.lang === 'en' ? 'Side B (inside)' : 'الوجه الثاني (الداخلي)'));
    pg.folds = [b + pw, b + 2 * pw];
    const posOf = (logical: number) => order[side].indexOf(logical);
    for (let pos = 0; pos < 3; pos++) { const logical = order[side][pos]; const id = names[side][logical]; pg.regions.push({ id, label: labels[id], rect: panelRect(pos), safe: safeRect(pos) }); }
    const cv = pg.cv; const reg = (id: string) => pg.regions.find((x) => x.id === id)!;
    if (side === 0) {
      // front cover
      const f = reg('front');
      if (isGlossy(c)) await glossyCover(c, cv, content, f);
      else {
      if (!c.images['bg:0']) cv.svg.push(`<rect x="${f.rect.x}" y="${f.rect.y}" width="${f.rect.w}" height="${f.rect.h}" fill="${c.t.soft}"/>`);
      await headerBand(c, cv, content, { x: f.safe.x, y: f.safe.y, w: f.safe.w, h: f.safe.h * 0.36 }, 'front', 22);
      const imgR = { x: f.safe.x + f.safe.w * 0.1, y: f.safe.y + f.safe.h * 0.4, w: f.safe.w * 0.8, h: f.safe.h * 0.36 };
      if (!(await placeImage(c, cv, 'cover', imgR, 'front'))) await subjectBadge(c, cv, imgR, 'front');
      await nameLines(c, cv, { x: f.safe.x, y: f.safe.y + f.safe.h * 0.8, w: f.safe.w, h: f.safe.h * 0.2 }, 'front');
      }
      // inner flap: intro + objectives
      const fl = reg('flap');
      await flow(c, cv, [introItem(c, content), listItem(c, 'objectives', c.s.lang === 'en' ? 'Learning objectives' : 'أهداف التعلم', content.objectives)], [{ id: 'flap', rect: fl.safe }], { spread: isGlossy(c) });
      // back: summary + activity
      const bk = reg('back');
      const backItems = [listItem(c, 'summary', c.s.lang === 'en' ? 'Key points' : 'ملخص مهم', content.summary)];
      if (content.activity) backItems.push(listItem(c, 'activity', content.activity.title, content.activity.steps, false));
      await flow(c, cv, backItems, [{ id: 'back', rect: bk.safe }], { spread: isGlossy(c) });
    } else {
      // one group of sections per inside panel (a brochure reads panel by panel); what does not fit moves on
      const secs = content.sections, n = secs.length, groups = [0, 1, 2].map((g) => secs.slice(Math.round((g * n) / 3), Math.round(((g + 1) * n) / 3)));
      let carry: Item[] = [];
      for (const [g, id] of ['in1', 'in2', 'in3'].entries()) {
        const items = [...carry, ...sectionItems(c, content, groups[g])];
        carry = await flow(c, cv, items, [{ id, rect: reg(id).safe }], { spread: isGlossy(c) && !carry.length });
      }
      if (carry.length) cv.placed.push({ id: 'overflow', kind: 'text', rect: { x: 0, y: 0, w: 1, h: 1 }, region: 'in3', fits: false, text: `${carry.length} عنصر لم يتسع — قلّل النص أو حجم الخط` });
    }
    // fold lines are guides only (not printed) — drawn by the preview overlay
    void posOf;
    pages.push(pg);
  }
  return pages;
}

async function flowEngine(c: Ctx, content: EduContent, W: number, H: number, b: number, mode: 'poster' | 'worksheet'): Promise<PageDraft[]> {
  const m = c.k * c.s.marginMm, cols = Math.max(1, c.s.columns);
  const inner = { x: b + m, y: b + m, w: W - 2 * b - 2 * m, h: H - 2 * b - 2 * m };
  const numbering = { n: 0 };
  let items: Item[] = [];
  if (mode === 'worksheet') {
    items = [{ id: 'instructions', render: async (w) => { const t = await text(c, c.s.lang === 'en' ? 'Solve the following:' : 'أجب عن الأسئلة التالية:', { size: 12, weight: 'bold', color: c.t.mute, w }); return stack(c, w, [{ ...t, id: 'instructions', text: '' }]); } }, ...sectionItems(c, content, content.sections, { numbering })];
  } else {
    if (content.intro.trim()) items.push(introItem(c, content));
    if (content.objectives.length) items.push(listItem(c, 'objectives', c.s.lang === 'en' ? 'Learning objectives' : 'أهداف التعلم', content.objectives));
    items.push(...(isGlossy(c) ? sectionItems(c, content) : sectionCards(c, content)));
    if (content.summary.length) items.push(listItem(c, 'summary', c.s.lang === 'en' ? 'Key points' : 'ملخص مهم', content.summary));
    if (content.activity) items.push(listItem(c, 'activity', content.activity.title, content.activity.steps));
  }
  const pages: PageDraft[] = [];
  let pageNo = 0;
  while (items.length || pageNo === 0) {
    const pg = newPage(pageNo === 0 ? (c.s.lang === 'en' ? 'Page 1' : 'الصفحة ١') : `${c.s.lang === 'en' ? 'Page' : 'الصفحة'} ${pageNo + 1}`);
    const cv = pg.cv;
    let top = inner.y;
    if (pageNo === 0) {
      const bandH = mode === 'worksheet' ? c.k * 28 : c.k * 38;
      const hasImg = c.images.cover && mode === 'poster';
      const band = { x: inner.x, y: top, w: hasImg ? inner.w * 0.72 : inner.w, h: bandH };
      await headerBand(c, cv, content, c.rtl && hasImg ? { ...band, x: inner.x + inner.w - band.w } : band, 'header', mode === 'worksheet' ? 20 : 26);
      if (hasImg) await placeImage(c, cv, 'cover', { x: c.rtl ? inner.x : inner.x + band.w + c.k * 3, y: top, w: inner.w - band.w - c.k * 3, h: bandH }, 'header');
      top += bandH + c.k * 4;
      if (mode === 'worksheet') { await infoLines(c, cv, { x: inner.x, y: top, w: inner.w, h: c.k * 9 }, 'info', true); top += c.k * 12; }
      pg.regions.push({ id: 'header', label: 'العنوان', rect: { x: inner.x, y: inner.y, w: inner.w, h: top - inner.y }, safe: { x: inner.x, y: inner.y, w: inner.w, h: top - inner.y } });
    }
    const gap = c.k * 6, colW = (inner.w - gap * (cols - 1)) / cols;
    const colRects = Array.from({ length: cols }, (_, i) => { const pos = c.rtl ? cols - 1 - i : i; return { id: `col${i + 1}`, rect: { x: inner.x + pos * (colW + gap), y: top, w: colW, h: inner.y + inner.h - top } }; });
    for (const cr of colRects) pg.regions.push({ id: cr.id, label: `${c.s.lang === 'en' ? 'Column' : 'العمود'} ${cr.id.slice(3)}`, rect: cr.rect, safe: cr.rect });
    const before = items.length;
    items = await flow(c, cv, items, colRects, { balance: true });
    pages.push(pg); pageNo++;
    if (items.length === before || pageNo > 8) { if (items.length) cv.placed.push({ id: 'overflow', kind: 'text', rect: { x: 0, y: 0, w: 1, h: 1 }, region: 'col1', fits: false, text: `${items.length} عنصر لم يتسع` }); break; }
  }
  if (mode === 'worksheet' && c.s.answerKey && content.sections.some((s) => s.exercises.some((e) => e.answer))) {
    const pg = newPage(c.s.lang === 'en' ? 'Answer key' : 'مفتاح الإجابات');
    await headerBand(c, pg.cv, { ...content, title: `${c.s.lang === 'en' ? 'Answer key' : 'مفتاح الإجابات'} — ${content.title}`, subtitle: '' }, { x: inner.x, y: inner.y, w: inner.w, h: c.k * 22 }, 'header', 16);
    const r = { id: 'col1', rect: { x: inner.x, y: inner.y + c.k * 26, w: inner.w, h: inner.h - c.k * 26 } };
    pg.regions.push({ id: 'col1', label: 'الإجابات', rect: r.rect, safe: r.rect });
    await flow(c, pg.cv, sectionItems(c, { ...content, sections: content.sections.map((s) => ({ ...s, body: '', bullets: [], examples: [] })) }, undefined, { numbering: { n: 0 }, showAnswers: true }), [r]);
    pages.push(pg);
  }
  return pages;
}

async function cardsEngine(c: Ctx, content: EduContent, W: number, H: number, b: number): Promise<PageDraft[]> {
  const m = c.k * c.s.marginMm, cols = Math.max(1, Math.min(4, c.s.columns)), rows = c.s.size === 'A3' ? 6 : 4;
  const inner = { x: b + m, y: b + m, w: W - 2 * b - 2 * m, h: H - 2 * b - 2 * m };
  const cw = inner.w / cols, ch = inner.h / rows, per = cols * rows;
  const cards = content.cards.length ? content.cards : [{ front: content.title, back: '' }];
  const sides = PRESETS[c.s.type].sides === 2 && c.s.sides === 2 ? 2 : 1;
  const pages: PageDraft[] = [];
  for (let start = 0; start < cards.length; start += per) for (let side = 0; side < sides; side++) {
    const pg = newPage(`${side === 0 ? (c.s.lang === 'en' ? 'Front' : 'الوجه الأمامي') : (c.s.lang === 'en' ? 'Back (print duplex, flip on long edge)' : 'الوجه الخلفي (طباعة وجهين — قلب من الحافة الطويلة)')} ${start / per + 1}`);
    for (let i = 0; i < per && start + i < cards.length; i++) {
      const card = cards[start + i]; const row = Math.floor(i / cols); let col = i % cols;
      if (side === 1) col = cols - 1 - col; // duplex: the back of each card lands behind its front
      if (c.rtl && side === 0) col = cols - 1 - col;
      if (c.rtl && side === 1) col = cols - 1 - col;
      const r = { x: inner.x + col * cw, y: inner.y + row * ch, w: cw, h: ch };
      const pad = c.k * 5;
      pg.cv.svg.push(`<rect x="${r.x + c.k}" y="${r.y + c.k}" width="${r.w - 2 * c.k}" height="${r.h - 2 * c.k}" rx="${c.k * 4}" fill="${side ? '#ffffff' : c.t.soft}" stroke="${c.t.p}" stroke-width="${Math.max(2, c.k * 0.5)}"/><rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="none" stroke="#94a3b8" stroke-width="2" stroke-dasharray="${c.k * 2} ${c.k * 1.5}"/>`);
      const str = side ? card.back : card.front;
      const tk = tokenize(str);
      const t = tk ? await equation(c, tk, { size: 18, w: r.w - pad * 2 }) : await text(c, str, { size: side ? 13 : 20, weight: side ? 'bold' : 'extrabold', color: c.t.ink, w: r.w - pad * 2, align: 'centre', maxH: r.h - pad * 2 });
      pg.cv.comps.push({ input: t.png, left: Math.round(r.x + (r.w - t.w) / 2), top: Math.round(r.y + (r.h - t.h) / 2) });
      pg.cv.placed.push({ id: `card${start + i}:${side}`, kind: tk ? 'equation' : 'text', rect: { x: Math.round(r.x + (r.w - t.w) / 2), y: Math.round(r.y + (r.h - t.h) / 2), w: t.w, h: t.h }, region: `card${start + i}`, fits: t.fits && t.h <= r.h - pad, missing: t.missing, text: str });
      pg.regions.push({ id: `card${start + i}`, label: `${start + i + 1}`, rect: r, safe: { x: r.x + pad, y: r.y + pad, w: r.w - 2 * pad, h: r.h - 2 * pad } });
    }
    pages.push(pg);
  }
  return pages;
}

async function certificateEngine(c: Ctx, content: EduContent, W: number, H: number, b: number): Promise<PageDraft[]> {
  const pg = newPage(c.s.lang === 'en' ? 'Certificate' : 'الشهادة');
  const m = c.k * c.s.marginMm, r = { x: b + m, y: b + m, w: W - 2 * b - 2 * m, h: H - 2 * b - 2 * m };
  pg.cv.svg.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${c.k * 4}" fill="${c.t.bg}" stroke="${c.t.s}" stroke-width="${c.k * 2.2}"/><rect x="${r.x + c.k * 4}" y="${r.y + c.k * 4}" width="${r.w - c.k * 8}" height="${r.h - c.k * 8}" rx="${c.k * 3}" fill="none" stroke="${c.t.p}" stroke-width="${c.k * 0.6}"/>`);
  const cert = content.certificate ?? { title: c.s.lang === 'en' ? 'Certificate of Appreciation' : 'شهادة تقدير', reason: content.intro, date: '', signer: '' };
  const en = c.s.lang === 'en';
  const lines: [string, number, Weight, string][] = [
    [cert.title, 34, 'extrabold', c.t.p],
    [en ? 'is proudly presented to' : 'تُمنح هذه الشهادة إلى', 14, 'regular', c.t.mute],
    [c.s.student || '……………………………………', 28, 'extrabold', c.t.ink],
    [cert.reason, 14, 'regular', c.t.ink],
    [[c.s.school, c.s.grade].filter(Boolean).join(' · '), 12, 'bold', c.t.mute],
  ];
  let y = r.y + r.h * 0.14;
  for (const [i, [str, size, weight, color]] of lines.entries()) {
    if (!str.trim()) continue;
    const t = await text(c, str, { size, weight, color, w: r.w * 0.78, align: 'centre' });
    pg.cv.comps.push({ input: t.png, left: Math.round(r.x + (r.w - t.w) / 2), top: Math.round(y) });
    pg.cv.placed.push({ id: `cert:${i}`, kind: 'text', rect: { x: Math.round(r.x + (r.w - t.w) / 2), y: Math.round(y), w: t.w, h: t.h }, region: 'body', fits: t.fits, missing: t.missing, text: str });
    y += t.h + c.k * 7;
  }
  const sig = [en ? 'Date' : 'التاريخ', en ? 'Signature' : 'التوقيع'];
  for (const [i, l] of sig.entries()) {
    const t = await text(c, `${l}: ${i === 0 ? (cert.date || '…………………') : (cert.signer || '…………………')}`, { size: 12, weight: 'bold', w: r.w * 0.35, align: 'centre' });
    const x = r.x + (i === 0 ? r.w * 0.12 : r.w * 0.53);
    pg.cv.comps.push({ input: t.png, left: Math.round(x + (r.w * 0.35 - t.w) / 2), top: Math.round(r.y + r.h * 0.8) });
    pg.cv.placed.push({ id: `cert:sig${i}`, kind: 'text', rect: { x: Math.round(x + (r.w * 0.35 - t.w) / 2), y: Math.round(r.y + r.h * 0.8), w: t.w, h: t.h }, region: 'body', fits: t.fits, text: l });
  }
  pg.regions.push({ id: 'body', label: 'الشهادة', rect: r, safe: { x: r.x + c.k * 6, y: r.y + c.k * 6, w: r.w - c.k * 12, h: r.h - c.k * 12 } });
  return [pg];
}

async function coverEngine(c: Ctx, content: EduContent, W: number, H: number, b: number): Promise<PageDraft[]> {
  const pg = newPage(c.s.lang === 'en' ? 'Cover' : 'الغلاف');
  const m = c.k * c.s.marginMm, r = { x: b + m, y: b + m, w: W - 2 * b - 2 * m, h: H - 2 * b - 2 * m };
  pg.cv.svg.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${c.k * 6}" fill="${c.t.soft}" stroke="${c.t.p}" stroke-width="${c.k * 1.2}"/>`);
  await headerBand(c, pg.cv, content, { x: r.x + c.k * 8, y: r.y + r.h * 0.1, w: r.w - c.k * 16, h: r.h * 0.22 }, 'body', 30);
  const img = { x: r.x + r.w * 0.2, y: r.y + r.h * 0.37, w: r.w * 0.6, h: r.h * 0.3 };
  if (!(await placeImage(c, pg.cv, 'cover', img, 'body'))) pg.cv.svg.push(`<circle cx="${img.x + img.w / 2}" cy="${img.y + img.h / 2}" r="${Math.min(img.w, img.h) * 0.4}" fill="${c.t.s}" fill-opacity="0.3"/>`);
  await infoLines(c, pg.cv, { x: r.x + c.k * 8, y: r.y + r.h * 0.74, w: r.w - c.k * 16, h: c.k * 10 }, 'body', true);
  const sup = await text(c, `${c.s.lang === 'en' ? 'Supervised by' : 'إشراف'}: ……………………`, { size: 12, weight: 'bold', w: r.w * 0.6, align: 'centre' });
  pg.cv.comps.push({ input: sup.png, left: Math.round(r.x + (r.w - sup.w) / 2), top: Math.round(r.y + r.h * 0.84) });
  pg.cv.placed.push({ id: 'cover:sup', kind: 'text', rect: { x: Math.round(r.x + (r.w - sup.w) / 2), y: Math.round(r.y + r.h * 0.84), w: sup.w, h: sup.h }, region: 'body', fits: sup.fits, text: '' });
  pg.regions.push({ id: 'body', label: 'الغلاف', rect: r, safe: r });
  return [pg];
}

async function mindmapEngine(c: Ctx, content: EduContent, W: number, H: number, b: number): Promise<PageDraft[]> {
  const pg = newPage(c.s.lang === 'en' ? 'Mind map' : 'الخريطة الذهنية');
  const m = c.k * c.s.marginMm, r = { x: b + m, y: b + m, w: W - 2 * b - 2 * m, h: H - 2 * b - 2 * m };
  const mm = content.mindmap ?? { center: content.title, branches: content.sections.slice(0, 7).map((s) => ({ label: s.heading, children: s.bullets.slice(0, 3) })) };
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, n = Math.max(1, mm.branches.length);
  const bw = Math.min(r.w * 0.26, c.k * 70), bh = Math.min(r.h * 0.26, c.k * 42);
  const rx = r.w / 2 - bw / 2 - c.k * 2, ry = r.h / 2 - bh / 2 - c.k * 2;
  const colors = [c.t.p, c.t.a, c.t.s, '#10b981', '#ef4444', '#8b5cf6', '#0ea5e9', '#f97316'];
  for (let i = 0; i < n; i++) {
    const ang = -Math.PI / 2 + (2 * Math.PI * i) / n, bx = cx + rx * Math.cos(ang), by = cy + ry * Math.sin(ang);
    pg.cv.svg.push(`<line x1="${cx}" y1="${cy}" x2="${bx}" y2="${by}" stroke="${colors[i % colors.length]}" stroke-width="${c.k * 1.4}" stroke-linecap="round"/>`);
  }
  const cR = Math.min(r.w, r.h) * 0.14;
  pg.cv.svg.push(`<circle cx="${cx}" cy="${cy}" r="${cR}" fill="${c.t.p}"/>`);
  const ct = await text(c, mm.center, { size: 17, weight: 'extrabold', color: '#ffffff', w: cR * 1.6, align: 'centre', maxH: cR * 1.6 });
  pg.cv.comps.push({ input: ct.png, left: Math.round(cx - ct.w / 2), top: Math.round(cy - ct.h / 2) });
  pg.cv.placed.push({ id: 'mm:center', kind: 'text', rect: { x: Math.round(cx - ct.w / 2), y: Math.round(cy - ct.h / 2), w: ct.w, h: ct.h }, region: 'center', fits: ct.fits, missing: ct.missing, text: mm.center });
  for (let i = 0; i < n; i++) {
    const br = mm.branches[i]; const ang = -Math.PI / 2 + (2 * Math.PI * i) / n;
    const bx = cx + rx * Math.cos(ang) - bw / 2, by = cy + ry * Math.sin(ang) - bh / 2;
    pg.cv.svg.push(`<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${c.k * 4}" fill="#ffffff" stroke="${colors[i % colors.length]}" stroke-width="${c.k * 1}"/>`);
    const t = await text(c, [br.label, ...br.children.map((x) => `• ${x}`)].join('\n'), { size: 10.5, weight: 'bold', w: bw - c.k * 6, maxH: bh - c.k * 4 });
    pg.cv.comps.push({ input: t.png, left: Math.round(bx + (bw - t.w) / 2), top: Math.round(by + (bh - t.h) / 2) });
    pg.cv.placed.push({ id: `mm:b${i}`, kind: 'text', rect: { x: Math.round(bx + (bw - t.w) / 2), y: Math.round(by + (bh - t.h) / 2), w: t.w, h: t.h }, region: `b${i}`, fits: t.fits, missing: t.missing, text: br.label });
    pg.regions.push({ id: `b${i}`, label: br.label, rect: { x: bx, y: by, w: bw, h: bh }, safe: { x: bx, y: by, w: bw, h: bh } });
  }
  pg.regions.push({ id: 'center', label: 'المركز', rect: { x: cx - cR, y: cy - cR, w: cR * 2, h: cR * 2 }, safe: { x: cx - cR, y: cy - cR, w: cR * 2, h: cR * 2 } });
  return [pg];
}

async function tableEngine(c: Ctx, content: EduContent, W: number, H: number, b: number): Promise<PageDraft[]> {
  const pg = newPage(c.s.lang === 'en' ? 'Table' : 'الجدول');
  const m = c.k * c.s.marginMm, r = { x: b + m, y: b + m, w: W - 2 * b - 2 * m, h: H - 2 * b - 2 * m };
  await headerBand(c, pg.cv, content, { x: r.x, y: r.y, w: r.w, h: c.k * 26 }, 'header', 20);
  const tb = content.table ?? { headers: [c.s.lang === 'en' ? 'Item' : 'البند', c.s.lang === 'en' ? 'Details' : 'التفاصيل'], rows: content.sections.map((s) => [s.heading, s.body || s.bullets.join('، ')]) };
  const cols = Math.max(1, tb.headers.length), top = r.y + c.k * 32, rowsN = tb.rows.length + 1;
  const rowH = Math.min(c.k * 22, (r.h - (top - r.y)) / rowsN), colW = r.w / cols;
  for (let ri = 0; ri < rowsN; ri++) for (let ci = 0; ci < cols; ci++) {
    const pos = c.rtl ? cols - 1 - ci : ci;
    const cell = { x: r.x + pos * colW, y: top + ri * rowH, w: colW, h: rowH };
    pg.cv.svg.push(`<rect x="${cell.x}" y="${cell.y}" width="${cell.w}" height="${cell.h}" fill="${ri === 0 ? c.t.p : ri % 2 ? '#ffffff' : c.t.soft}" stroke="${c.t.p}" stroke-opacity="0.4" stroke-width="2"/>`);
    const str = ri === 0 ? tb.headers[ci] : (tb.rows[ri - 1]?.[ci] ?? '');
    const tk = ri > 0 ? tokenize(str) : null; // «6 × 1» drawn by the equation engine (direction-safe)
    const t = tk ? await equation(c, tk, { size: 11, w: cell.w - c.k * 4 }) : await text(c, str, { size: ri === 0 ? 12 : 10.5, weight: ri === 0 ? 'extrabold' : 'regular', color: ri === 0 ? '#ffffff' : c.t.ink, w: cell.w - c.k * 4, align: 'centre', maxH: cell.h - c.k * 2 });
    pg.cv.comps.push({ input: t.png, left: Math.round(cell.x + (cell.w - t.w) / 2), top: Math.round(cell.y + (cell.h - t.h) / 2) });
    pg.cv.placed.push({ id: `cell:${ri}:${ci}`, kind: tk ? 'equation' : 'text', rect: { x: Math.round(cell.x + (cell.w - t.w) / 2), y: Math.round(cell.y + (cell.h - t.h) / 2), w: t.w, h: t.h }, region: 'table', fits: t.fits, missing: t.missing, text: str });
  }
  pg.regions.push({ id: 'table', label: 'الجدول', rect: { x: r.x, y: top, w: r.w, h: rowH * rowsN }, safe: { x: r.x, y: top, w: r.w, h: rowH * rowsN } });
  return [pg];
}

/** The AI background of a face (brochure: one per face; other designs: one for all pages), softened for print. */
async function background(c: Ctx, W: number, H: number, i: number, engine: string): Promise<{ png: Buffer; meta: string } | null> {
  const key = c.images[`bg:${i}`] ?? (engine !== 'panels' ? c.images['bg:0'] : undefined);
  if (!key) return null;
  try {
    const buf = await storage().get(key);
    const meta = await sharp(buf).metadata();
    const png = await sharp(buf).resize(W, H, { fit: 'cover' }).modulate({ brightness: 1.04, saturation: 0.92 }).removeAlpha().png().toBuffer();
    return { png, meta: `${meta.width}x${meta.height}` };
  } catch { return null; }
}

const gradeNo = (g: string) => { const m = g.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).match(/\d+/); if (m) return Number(m[0]); const w = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس']; const i = w.findIndex((x) => g.includes(x)); return i >= 0 ? i + 1 : 5; };
/** «اختيار ذكي»: young pupils get the playful style, middle grades colourful, certificates luxury, the rest creative. */
export function resolveStyle(s: EduSettings): Exclude<EduSettings['style'], 'auto'> {
  if (s.style !== 'auto') return s.style;
  if (PRESETS[s.type].engine === 'certificate') return 'luxury';
  // brochures and posters: the polished printed-brochure look (icon pills, cream cards, gold rims)
  if (['panels', 'poster'].includes(PRESETS[s.type].engine)) return 'glossy';
  const g = gradeNo(s.grade);
  return g <= 3 ? 'kids_cartoon' : g <= 6 ? 'school_colorful' : 'creative';
}
const star = (cx: number, cy: number, r: number) => Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r; return `${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`; }).join(' ');

/** Background decoration of the visual style — only in the margins/corners, never under text (not part of QC regions). */
function decor(c: Ctx, W: number, H: number, b: number, engine: string): string {
  const st = resolveStyle(c.s), m = c.k * c.s.marginMm, t = c.t;
  const x0 = b, y0 = b, x1 = W - b, y1 = H - b, out: string[] = [];
  if (st === 'glossy') {
    // each panel (or the page) gets a sky gradient, a blue wave with a gold line along the top and the bottom margins
    const panels = engine === 'panels' ? 3 : 1, pw = (x1 - x0) / panels, wv = Math.min(m * 0.85, c.k * 9);
    for (let i = 0; i < panels; i++) {
      const px = x0 + i * pw, g = `sky${++gid}`, lip = c.k * 1.6;
      if (!Object.keys(c.images).some((k) => k.startsWith('bg:'))) out.push(`<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(t.s, 0.72)}"/><stop offset="0.5" stop-color="#ffffff"/><stop offset="1" stop-color="${shade(t.s, 0.65)}"/></linearGradient></defs><rect x="${px}" y="${y0}" width="${pw}" height="${y1 - y0}" fill="url(#${g})"/>`);
      out.push(`<path d="M${px} ${y0} L${px + pw} ${y0} L${px + pw} ${y0 + wv * 0.55} Q${px + pw * 0.7} ${y0 + wv * 1.15} ${px + pw * 0.45} ${y0 + wv * 0.6} T${px} ${y0 + wv * 0.7} Z" fill="${t.p}"/><path d="M${px + pw} ${y0 + wv * 0.55} Q${px + pw * 0.7} ${y0 + wv * 1.15} ${px + pw * 0.45} ${y0 + wv * 0.6} T${px} ${y0 + wv * 0.7}" fill="none" stroke="${GOLD}" stroke-width="${lip}"/>`);
      out.push(`<path d="M${px} ${y1} L${px + pw} ${y1} L${px + pw} ${y1 - wv * 0.75} Q${px + pw * 0.62} ${y1 - wv * 1.2} ${px + pw * 0.35} ${y1 - wv * 0.55} T${px} ${y1 - wv * 0.6} Z" fill="${shade(t.p, -0.15)}"/><path d="M${px + pw} ${y1 - wv * 0.75} Q${px + pw * 0.62} ${y1 - wv * 1.2} ${px + pw * 0.35} ${y1 - wv * 0.55} T${px} ${y1 - wv * 0.6}" fill="none" stroke="${GOLD}" stroke-width="${lip}"/>`);
      if (i > 0) out.push(`<line x1="${px}" y1="${y0}" x2="${px}" y2="${y1}" stroke="${GOLD}" stroke-opacity="0.55" stroke-width="${c.k * 0.5}"/>`);
    }
  } else if (st === 'kids_cartoon') {
    const r = m * 0.34;
    for (const [x, y, col] of [[x0 + m * 0.5, y0 + m * 0.5, t.a], [x1 - m * 0.5, y0 + m * 0.5, t.s], [x0 + m * 0.5, y1 - m * 0.5, t.s], [x1 - m * 0.5, y1 - m * 0.5, t.a]] as [number, number, string][]) out.push(`<polygon points="${star(x, y, r)}" fill="${col}" fill-opacity="0.85"/>`);
    const n = Math.floor((x1 - x0 - 3 * m) / (m * 0.9));
    for (let i = 0; i < n; i++) { const cx = x0 + 1.5 * m + i * m * 0.9 + m * 0.45; out.push(`<circle cx="${cx}" cy="${y1 - m * 0.5}" r="${m * 0.16}" fill="${[t.p, t.a, t.s][i % 3]}" fill-opacity="0.55"/><circle cx="${cx}" cy="${y0 + m * 0.5}" r="${m * 0.12}" fill="${[t.s, t.p, t.a][i % 3]}" fill-opacity="0.4"/>`); }
  } else if (st === 'luxury') {
    const i1 = m * 0.32, i2 = m * 0.5;
    out.push(`<rect x="${x0 + i1}" y="${y0 + i1}" width="${x1 - x0 - 2 * i1}" height="${y1 - y0 - 2 * i1}" fill="none" stroke="${t.a}" stroke-width="${c.k * 0.9}"/><rect x="${x0 + i2}" y="${y0 + i2}" width="${x1 - x0 - 2 * i2}" height="${y1 - y0 - 2 * i2}" fill="none" stroke="${t.s}" stroke-width="${c.k * 0.35}"/>`);
    const L = m * 1.4;
    for (const [x, y, dx, dy] of [[x0 + i2, y0 + i2, 1, 1], [x1 - i2, y0 + i2, -1, 1], [x0 + i2, y1 - i2, 1, -1], [x1 - i2, y1 - i2, -1, -1]]) out.push(`<path d="M${x} ${y + dy * L} L${x} ${y} L${x + dx * L} ${y}" fill="none" stroke="${t.a}" stroke-width="${c.k * 1.4}"/><circle cx="${x + dx * m * 0.25}" cy="${y + dy * m * 0.25}" r="${c.k * 0.9}" fill="${t.a}"/>`);
  } else if (st === 'school_colorful') {
    const band = m * 0.38, cols = [t.p, t.a, t.s, '#10b981', '#ef4444'], seg = (x1 - x0) / cols.length;
    cols.forEach((col, i) => out.push(`<rect x="${x0 + i * seg}" y="${y0}" width="${seg + 1}" height="${band}" fill="${col}"/><rect x="${x0 + i * seg}" y="${y1 - band}" width="${seg + 1}" height="${band}" fill="${cols[(i + 2) % cols.length]}"/>`));
  } else if (st === 'minimal') {
    out.push(`<line x1="${x0 + m}" y1="${y1 - m * 0.45}" x2="${x1 - m}" y2="${y1 - m * 0.45}" stroke="${t.p}" stroke-opacity="0.35" stroke-width="${c.k * 0.3}"/>`);
  } else if (st === 'illustrated') {
    out.push(`<defs><pattern id="dots" width="${c.k * 5}" height="${c.k * 5}" patternUnits="userSpaceOnUse"><circle cx="${c.k * 2.5}" cy="${c.k * 2.5}" r="${c.k * 0.45}" fill="${t.p}" fill-opacity="0.13"/></pattern></defs><rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="url(#dots)"/>`);
  } else if (st === 'three_d') {
    out.push(`<rect x="${x0 + m * 0.35}" y="${y0 + m * 0.35}" width="${x1 - x0 - m * 0.7}" height="${y1 - y0 - m * 0.7}" rx="${c.k * 5}" fill="none" stroke="${t.p}" stroke-opacity="0.14" stroke-width="${c.k * 2.4}"/>`);
  } else { // creative: corner triangles
    const L = m * 2.6;
    out.push(`<polygon points="${x0},${y0} ${x0 + L},${y0} ${x0},${y0 + L}" fill="${t.a}" fill-opacity="0.9"/><polygon points="${x0},${y0} ${x0 + L * 0.55},${y0} ${x0},${y0 + L * 0.55}" fill="${t.p}"/><polygon points="${x1},${y1} ${x1 - L},${y1} ${x1},${y1 - L}" fill="${t.s}" fill-opacity="0.9"/><polygon points="${x1},${y1} ${x1 - L * 0.55},${y1} ${x1},${y1 - L * 0.55}" fill="${t.p}"/>`);
  }
  void engine;
  return out.join('');
}

/** Renders the whole document. `images` maps slot → storage key (only images that really exist are placed). */
async function renderOnce(s: EduSettings, content: EduContent, opts: { dpi: number; images?: Record<string, string> }): Promise<RenderedDoc> {
  const preset = PRESETS[s.type];
  const trim = paperMm(s), bleed = s.bleedMm;
  const k = opts.dpi / 25.4;
  const W = Math.round((trim.w + 2 * bleed) * k), H = Math.round((trim.h + 2 * bleed) * k), b = Math.round(bleed * k);
  const c: Ctx = { k, s, t: THEMES[s.palette], rtl: s.lang !== 'en', cache: new Map(), images: opts.images ?? {} };
  const drafts = preset.engine === 'panels' ? await panelsEngine(c, content, W, H, b)
    : preset.engine === 'worksheet' ? await flowEngine(c, content, W, H, b, 'worksheet')
    : preset.engine === 'cards' ? await cardsEngine(c, content, W, H, b)
    : preset.engine === 'certificate' ? await certificateEngine(c, content, W, H, b)
    : preset.engine === 'cover' ? await coverEngine(c, content, W, H, b)
    : preset.engine === 'mindmap' ? await mindmapEngine(c, content, W, H, b)
    : preset.engine === 'table' ? await tableEngine(c, content, W, H, b)
    : await flowEngine(c, content, W, H, b, 'poster');
  const pages: RenderedPage[] = [];
  for (const [i, d] of drafts.entries()) {
    const bg = resolveStyle(s) === 'luxury' && s.palette !== 'navy_gold' ? '#fffdf7' : c.t.bg;
    const art = await background(c, W, H, i, preset.engine);
    // over an AI painting every reading area sits on a frosted card (readable text, real contrast)
    // the frosted card wraps only what is printed in each area, so the painting stays visible around it
    const frost = art && resolveStyle(s) !== 'glossy' ? d.regions.map((r) => {
      const inR = d.cv.placed.filter((x) => x.region === r.id && x.id !== 'overflow');
      if (!inR.length) return '';
      const e = c.k * 3, top = Math.max(r.rect.y, Math.min(...inR.map((x) => x.rect.y)) - e), bottom = Math.min(r.rect.y + r.rect.h, Math.max(...inR.map((x) => x.rect.y + x.rect.h)) + e);
      return `<rect x="${r.safe.x - e}" y="${top}" width="${r.safe.w + 2 * e}" height="${bottom - top}" rx="${c.k * 4}" fill="#ffffff" fill-opacity="0.88"/>`;
    }).join('') : '';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${art ? '' : `<rect width="${W}" height="${H}" fill="${bg}"/>`}${decor(c, W, H, b, preset.engine)}${frost}${d.cv.svg.join('')}</svg>`;
    const layers: OverlayOptions[] = [...(art ? [{ input: art.png, left: 0, top: 0 }] : []), { input: Buffer.from(svg), left: 0, top: 0 }, ...d.cv.comps];
    const png = await sharp({ create: { width: W, height: H, channels: 4, background: bg } }).composite(layers).png({ compressionLevel: 6 }).toBuffer();
    const placed = art ? [...d.cv.placed, { id: 'img:bg', kind: 'image' as const, rect: { x: 0, y: 0, w: W, h: H }, region: '__page', fits: true, text: art.meta }] : d.cv.placed;
    pages.push({ png, widthPx: W, heightPx: H, dpi: opts.dpi, trimMm: trim, bleedMm: bleed, placed, regions: d.regions, folds: d.folds, label: d.label });
  }
  return { pages, engine: preset.engine, fontScale: s.fontScale };
}

const overflowed = (d: RenderedDoc) => d.pages.some((p) => p.placed.some((x) => !x.fits || x.id === 'overflow'));
/**
 * Auto-fit («ملء الصفحة»): the largest font scale (0.8 up to 1.7 for posters/brochures, 1.5 for worksheets) at which nothing overflows and no page is added,
 * found by a quick binary search on low-resolution renders, then rendered at the requested DPI with a small safety
 * margin. Sparse layouts get bigger, readable text; dense ones shrink before they would overflow.
 */
export async function fitScale(s: EduSettings, content: EduContent, images?: Record<string, string>): Promise<number> {
  const eng = PRESETS[s.type].engine;
  if (!s.autoFit || !['panels', 'poster', 'worksheet'].includes(eng)) return s.fontScale;
  const probe = (f: number) => renderOnce({ ...s, fontScale: f }, content, { dpi: 40, images });
  // a poster / teaching aid / project / custom design is ONE page: shrink (down to 60 %) rather than add a page
  const singlePage = eng === 'poster' && s.type !== 'booklet';
  const floor = singlePage ? 0.6 : 0.8;
  const minDoc = await probe(floor);
  const basePages = singlePage ? 1 : minDoc.pages.length;
  if (overflowed(minDoc) || minDoc.pages.length > basePages) return floor;
  const ok = async (f: number) => { const d = await probe(f); return !overflowed(d) && d.pages.length <= basePages; };
  let lo = floor, hi = eng === 'worksheet' ? 1.5 : resolveStyle(s) === 'glossy' ? 1.5 : 1.7;
  if (await ok(hi)) return hi;
  for (let i = 0; i < 5; i++) { const mid = (lo + hi) / 2; if (await ok(mid)) lo = mid; else hi = mid; }
  return Math.round(Math.max(floor, lo * 0.96) * 100) / 100;
}

export async function renderDoc(s: EduSettings, content: EduContent, opts: { dpi: number; images?: Record<string, string> }): Promise<RenderedDoc> {
  const f = await fitScale(s, content, opts.images);
  let doc = await renderOnce({ ...s, fontScale: f }, content, opts);
  // safety: if rounding at full resolution made something overflow, step down until it fits
  for (let step = 1; step <= 3 && s.autoFit && overflowed(doc) && f - step * 0.05 >= 0.75; step++) doc = await renderOnce({ ...s, fontScale: f - step * 0.05 }, content, opts);
  return doc;
}
