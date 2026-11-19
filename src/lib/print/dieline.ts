/**
 * Supplier dieline reader (SVG). Classifies every line as CUT / FOLD (crease) / PERFORATION / GLUE by layer name,
 * stroke colour and dash pattern (the conventions dieline makers use), converts the geometry to absolute millimetres,
 * and finds the panels between fold lines. Nothing is guessed silently: anything it cannot read is reported, and
 * production stays blocked when the dieline is unusable.
 */
export interface Dieline {
  wMm: number; hMm: number;
  cut: string[]; fold: string[]; perf: string[]; glue: { x: number; y: number; w: number; h: number }[];
  /** rectangles (mm, dieline origin) between fold lines, largest first */
  panels: { x: number; y: number; w: number; h: number }[];
  warnings: string[];
}
type Kind = 'cut' | 'fold' | 'perf' | 'glue' | 'ignore';

const num = (s: string | undefined) => (s === undefined ? NaN : parseFloat(s));
function unitToMm(v: string | undefined): number | null {
  if (!v) return null;
  const m = v.trim().match(/^([\d.]+)\s*(mm|cm|in|pt|px)?$/i); if (!m) return null;
  const n = Number(m[1]); const u = (m[2] ?? 'px').toLowerCase();
  return u === 'mm' ? n : u === 'cm' ? n * 10 : u === 'in' ? n * 25.4 : u === 'pt' ? (n * 25.4) / 72 : (n * 25.4) / 96; // CSS px = 1/96 in
}
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, 'i'))?.[1] ?? tag.match(new RegExp(`\\s${name}\\s*=\\s*'([^']*)'`, 'i'))?.[1];
function style(tag: string, prop: string) { const s = attr(tag, 'style') ?? ''; return s.match(new RegExp(`${prop}\\s*:\\s*([^;]+)`, 'i'))?.[1]?.trim() ?? attr(tag, prop); }
function hexOf(c: string | undefined): string | null {
  if (!c) return null; const s = c.trim().toLowerCase();
  const named: Record<string, string> = { red: '#ff0000', magenta: '#ff00ff', fuchsia: '#ff00ff', blue: '#0000ff', green: '#008000', lime: '#00ff00', cyan: '#00ffff', black: '#000000', orange: '#ffa500' };
  if (named[s]) return named[s];
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  const rgb = s.match(/rgb\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/); if (rgb) return `#${[rgb[1], rgb[2], rgb[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('')}`;
  return null;
}
function classify(tag: string, groups: string[]): Kind {
  const name = [...groups, attr(tag, 'id') ?? '', attr(tag, 'class') ?? '', attr(tag, 'inkscape:label') ?? ''].join(' ').toLowerCase();
  if (/glue|لصق/.test(name)) return 'glue';
  if (/perf|تخريم/.test(name)) return 'perf';
  if (/fold|crease|score|ثني|طي/.test(name)) return 'fold';
  if (/cut|die|قص/.test(name)) return 'cut';
  if (/bleed|safe|dimension|text|note|guide|نزيف|أمان/.test(name)) return 'ignore';
  const dash = style(tag, 'stroke-dasharray');
  const color = hexOf(style(tag, 'stroke'));
  if (!color || style(tag, 'stroke') === 'none') return 'ignore';
  const n = parseInt(color.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (dash && dash !== 'none') return r > 150 && b > 150 && g < 100 ? 'perf' : 'fold';
  if (g > 120 && r < 100) return 'fold'; // green / cyan creases
  if (b > 150 && r < 100 && g < 150) return 'fold'; // blue creases
  return 'cut'; // solid red / magenta / black = knife
}

/** converts any SVG path (relative/absolute, H V L C S Q T A Z) to absolute M L C A Z in mm */
export function normalizePath(d: string, k: number, ox: number, oy: number): string {
  const toks = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const out: string[] = []; let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, lcx = 0, lcy = 0, lq: [number, number] | null = null;
  const P = (px: number, py: number) => `${r2((px - ox) * k)} ${r2((py - oy) * k)}`;
  const n = () => Number(toks[i++]);
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    if (C === 'Z') { out.push('Z'); x = sx; y = sy; lq = null; continue; }
    if (i >= toks.length || /[a-zA-Z]/.test(toks[i])) { if (C !== 'Z') i++; continue; }
    if (C === 'M') { x = (rel ? x : 0) + n(); y = (rel ? y : 0) + n(); sx = x; sy = y; out.push(`M${P(x, y)}`); cmd = rel ? 'l' : 'L'; lq = null; }
    else if (C === 'L') { x = (rel ? x : 0) + n(); y = (rel ? y : 0) + n(); out.push(`L${P(x, y)}`); lq = null; }
    else if (C === 'H') { x = (rel ? x : 0) + n(); out.push(`L${P(x, y)}`); lq = null; }
    else if (C === 'V') { y = (rel ? y : 0) + n(); out.push(`L${P(x, y)}`); lq = null; }
    else if (C === 'C') { const a = [n(), n(), n(), n(), n(), n()].map((v, j) => v + (rel ? (j % 2 ? y : x) : 0)); out.push(`C${P(a[0], a[1])} ${P(a[2], a[3])} ${P(a[4], a[5])}`); lcx = a[2]; lcy = a[3]; x = a[4]; y = a[5]; lq = null; }
    else if (C === 'S') { const a = [n(), n(), n(), n()].map((v, j) => v + (rel ? (j % 2 ? y : x) : 0)); const c1x = 2 * x - lcx, c1y = 2 * y - lcy; out.push(`C${P(c1x, c1y)} ${P(a[0], a[1])} ${P(a[2], a[3])}`); lcx = a[0]; lcy = a[1]; x = a[2]; y = a[3]; lq = null; }
    else if (C === 'Q' || C === 'T') {
      let qx: number, qy: number;
      if (C === 'Q') { qx = n() + (rel ? x : 0); qy = n() + (rel ? y : 0); } else { qx = lq ? 2 * x - lq[0] : x; qy = lq ? 2 * y - lq[1] : y; }
      const ex = n() + (rel ? x : 0), ey = n() + (rel ? y : 0);
      out.push(`C${P(x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y))} ${P(ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey))} ${P(ex, ey)}`);
      lq = [qx, qy]; x = ex; y = ey;
    } else if (C === 'A') { const [rx, ry, rot, la, sw, ex0, ey0] = [n(), n(), n(), n(), n(), n(), n()]; const ex = ex0 + (rel ? x : 0), ey = ey0 + (rel ? y : 0); out.push(`A${r2(rx * k)} ${r2(ry * k)} ${rot} ${la} ${sw} ${P(ex, ey)}`); x = ex; y = ey; lq = null; }
    else i++;
  }
  return out.join(' ');
}
const r2 = (v: number) => Math.round(v * 100) / 100;

function shapeToPath(tag: string, el: string): string | null {
  const a = (k: string) => num(attr(tag, k));
  if (el === 'path') return attr(tag, 'd') ?? null;
  if (el === 'line') return `M${a('x1')} ${a('y1')} L${a('x2')} ${a('y2')}`;
  if (el === 'rect') { const x = a('x') || 0, y = a('y') || 0, w = a('width'), h = a('height'); return w > 0 && h > 0 ? `M${x} ${y} H${x + w} V${y + h} H${x} Z` : null; }
  if (el === 'polyline' || el === 'polygon') { const p = (attr(tag, 'points') ?? '').trim().split(/[\s,]+/).map(Number); if (p.length < 4) return null; let d = `M${p[0]} ${p[1]}`; for (let j = 2; j + 1 < p.length; j += 2) d += ` L${p[j]} ${p[j + 1]}`; return el === 'polygon' ? `${d} Z` : d; }
  if (el === 'circle' || el === 'ellipse') { const cx = a('cx') || 0, cy = a('cy') || 0, rx = el === 'circle' ? a('r') : a('rx'), ry = el === 'circle' ? a('r') : a('ry'); return rx > 0 ? `M${cx - rx} ${cy} A${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z` : null; }
  return null;
}
/** absolute points of a normalised path (for bounds / straight-line detection) */
function points(d: string): number[][] {
  const pts: number[][] = [];
  for (const m of d.matchAll(/([MLCA])([^MLCAZ]*)/g)) { const v = m[2].trim().split(/\s+/).map(Number); if (m[1] === 'A') pts.push([v[5], v[6]]); else for (let j = 0; j + 1 < v.length; j += 2) pts.push([v[j], v[j + 1]]); }
  return pts.filter((p) => p.every(Number.isFinite));
}

/** moves a normalised mm path (M L C A Z) by dx, dy */
export function movePath(d: string, dx: number, dy: number): string {
  return d.replace(/([MLCA])([^MLCAZ]*)/g, (_s, c: string, v: string) => { const a = v.trim().split(/\s+/).map(Number); const o = c === 'A' ? a.map((q, j) => (j === 5 ? q + dx : j === 6 ? q + dy : q)) : a.map((q, j) => (j % 2 ? q + dy : q + dx)); return `${c}${o.map(r2).join(' ')} `; }).replace(/\s+Z/g, ' Z').trim();
}

export function parseDieline(svg: string): Dieline {
  const warnings: string[] = [];
  if (!/<svg[\s>]/i.test(svg)) throw new Error('الملف ليس SVG — صدّر الـDieline من Illustrator/CorelDraw بصيغة SVG');
  if (/<script|on\w+\s*=/i.test(svg)) throw new Error('ملف SVG يحتوي على سكربت — غير مقبول');
  const root = svg.match(/<svg\b[^>]*>/i)![0];
  const vb = (attr(root, 'viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  const wMm0 = unitToMm(attr(root, 'width'));
  let k = 25.4 / 96, ox = 0, oy = 0; // default: user units are CSS px
  if (vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0) {
    ox = vb[0]; oy = vb[1];
    if (wMm0) k = wMm0 / vb[2];
    else warnings.push('لا توجد وحدة للعرض في الملف — افتُرض 96 بكسل/إنش؛ تأكد من المقاس');
  } else if (!wMm0) warnings.push('لا يوجد viewBox أو وحدات — افتُرض 96 بكسل/إنش؛ تأكد من المقاس');
  if (/transform\s*=/.test(svg.replace(/<svg\b[^>]*>/i, ''))) warnings.push('الملف يحتوي على تحويلات (transform) — قد تكون بعض الخطوط في غير مكانها؛ يُفضّل تصدير الـDieline مسطّحًا (Expand/Flatten)');
  const res = { cut: [] as string[], fold: [] as string[], perf: [] as string[], glue: [] as Dieline['glue'] };
  // walk elements keeping the names of open groups (layers)
  const stack: string[] = [];
  for (const m of svg.matchAll(/<\/?([a-zA-Z:]+)\b[^>]*?\/?>/g)) {
    const tag = m[0], el = m[1].toLowerCase();
    if (el === 'g') { if (tag.startsWith('</')) stack.pop(); else if (!tag.endsWith('/>')) stack.push([attr(tag, 'id'), attr(tag, 'inkscape:label'), attr(tag, 'class')].filter(Boolean).join(' ')); continue; }
    if (tag.startsWith('</') || !['path', 'line', 'rect', 'polyline', 'polygon', 'circle', 'ellipse'].includes(el)) continue;
    const kind = classify(tag, stack); if (kind === 'ignore') continue;
    const raw = shapeToPath(tag, el); if (!raw) continue;
    const d = normalizePath(raw, k, ox, oy);
    if (kind === 'glue') { const p = points(d); if (p.length) { const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]); res.glue.push({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }); } continue; }
    res[kind].push(d);
  }
  if (!res.cut.length) throw new Error('لم يُعثر على خط قص في الـDieline (طبقة/لون القص) — سمِّ طبقة القص «Cut» أو استخدم خطًا أحمر/أسود متصلًا');
  const all = res.cut.flatMap(points);
  const minX = Math.min(...all.map((p) => p[0])), minY = Math.min(...all.map((p) => p[1])), maxX = Math.max(...all.map((p) => p[0])), maxY = Math.max(...all.map((p) => p[1]));
  // move the dieline so the cut outline starts at 0,0
  const shift = (d: string) => d.replace(/([MLCA])([^MLCAZ]*)/g, (_s, c: string, v: string) => { const a = v.trim().split(/\s+/).map(Number); const o = c === 'A' ? a.map((q, j) => (j === 5 ? q - minX : j === 6 ? q - minY : q)) : a.map((q, j) => (j % 2 ? q - minY : q - minX)); return `${c}${o.map(r2).join(' ')} `; }).replace(/\s+Z/g, ' Z').trim();
  const out: Dieline = { wMm: r2(maxX - minX), hMm: r2(maxY - minY), cut: res.cut.map(shift), fold: res.fold.map(shift), perf: res.perf.map(shift), glue: res.glue.map((g) => ({ ...g, x: r2(g.x - minX), y: r2(g.y - minY) })), panels: [], warnings };
  if (out.wMm < 20 || out.hMm < 20) warnings.push(`مقاس الـDieline صغير جدًا (${out.wMm}×${out.hMm} مم) — تحقق من الوحدات`);
  if (out.wMm > 2000 || out.hMm > 2000) warnings.push(`مقاس الـDieline كبير جدًا (${out.wMm}×${out.hMm} مم) — تحقق من الوحدات`);
  if (!out.fold.length) warnings.push('لا توجد خطوط طي في الملف — تأكد من طبقة الثني (Crease/Fold)');
  // panels: the grid between straight vertical / horizontal fold lines, kept when inside the cut outline's bounds
  const vx = new Set<number>(), hy = new Set<number>();
  for (const d of out.fold) { const p = points(d); if (p.length < 2) continue; const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]); if (Math.max(...xs) - Math.min(...xs) < 0.5 && Math.max(...ys) - Math.min(...ys) > 5) vx.add(r2(xs[0])); else if (Math.max(...ys) - Math.min(...ys) < 0.5 && Math.max(...xs) - Math.min(...xs) > 5) hy.add(r2(ys[0])); }
  const X = [0, ...[...vx].sort((a, b) => a - b), out.wMm], Y = [0, ...[...hy].sort((a, b) => a - b), out.hMm];
  // a cell is a panel only if its centre lies inside the cut outline (even–odd test on the outline's vertices)
  const polys = out.cut.map(points).filter((p) => p.length > 2);
  const inside = (x: number, y: number) => polys.some((pl) => { let c = false; for (let a = 0, b = pl.length - 1; a < pl.length; b = a++) { const [xa, ya] = pl[a], [xb, yb] = pl[b]; if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) c = !c; } return c; });
  for (let i = 0; i + 1 < X.length; i++) for (let j = 0; j + 1 < Y.length; j++) { const w = X[i + 1] - X[i], h = Y[j + 1] - Y[j]; if (w > 10 && h > 10 && inside(X[i] + w / 2, Y[j] + h / 2)) out.panels.push({ x: X[i], y: Y[j], w: r2(w), h: r2(h) }); }
  out.panels.sort((a, b) => b.w * b.h - a.w * a.h);
  return out;
}
