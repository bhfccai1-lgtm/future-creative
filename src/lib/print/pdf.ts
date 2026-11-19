/**
 * Print PDF writer (dependency-free): one artwork image per page at the exact media size (trim + bleed), TrimBox /
 * BleedBox, and production layers as REAL vectors in named spot colours that cutters/RIPs recognise:
 * «CutContour» (die/through cut), «KissCut», «Fold» (crease, dashed). Colour: DeviceRGB, or DeviceCMYK when the art was
 * converted (built-in generic CMYK profile unless the printer's ICC profile is supplied). Not a PDF/X file.
 */
export interface PdfPage { jpeg: Buffer; cmyk: boolean; gray?: boolean; widthPx: number; heightPx: number; mediaMm: { w: number; h: number }; bleedMm: number; cut?: string; kissCut?: string[]; folds?: number[]; foldPaths?: string[]; perfPaths?: string[] }
const PT = 72 / 25.4;
const f2 = (v: number) => (Math.round(v * 100) / 100).toString();

/** converts our mm path (M/H/V/L/A/Z, y down) to PDF path operators in points (y up); arcs become cubic Béziers */
export function pathToPdf(d: string, hMm: number): string {
  const out: string[] = []; let x = 0, y = 0, sx = 0, sy = 0;
  const P = (px: number, py: number) => `${f2(px * PT)} ${f2((hMm - py) * PT)}`;
  for (const m of d.matchAll(/([MLHVACZ])([^MLHVACZ]*)/gi)) {
    const c = m[1].toUpperCase(); const n = m[2].trim() ? m[2].trim().split(/[\s,]+/).map(Number) : [];
    if (c === 'M') { x = n[0]; y = n[1]; sx = x; sy = y; out.push(`${P(x, y)} m`); }
    else if (c === 'L') { x = n[0]; y = n[1]; out.push(`${P(x, y)} l`); }
    else if (c === 'H') { x = n[0]; out.push(`${P(x, y)} l`); }
    else if (c === 'V') { y = n[0]; out.push(`${P(x, y)} l`); }
    else if (c === 'Z') { out.push('h'); x = sx; y = sy; }
    else if (c === 'C') { out.push(`${P(n[0], n[1])} ${P(n[2], n[3])} ${P(n[4], n[5])} c`); x = n[4]; y = n[5]; }
    else if (c === 'A') { const [rx, ry, , large, sweep, ex, ey] = n; out.push(...arc(x, y, rx, ry, large, sweep, ex, ey).map((b) => `${P(b[0], b[1])} ${P(b[2], b[3])} ${P(b[4], b[5])} c`)); x = ex; y = ey; }
  }
  return out.join(' ');
}
/** SVG elliptical arc (no rotation) → cubic Bézier segments */
function arc(x1: number, y1: number, rx: number, ry: number, large: number, sweep: number, x2: number, y2: number): number[][] {
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  let l = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry); if (l > 1) { rx *= Math.sqrt(l); ry *= Math.sqrt(l); l = 1; }
  const sign = large === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * dy * dy - ry * ry * dx * dx, den = rx * rx * dy * dy + ry * ry * dx * dx;
  const co = sign * Math.sqrt(Math.max(0, num / den));
  const cx = co * ((rx * dy) / ry) + (x1 + x2) / 2, cy = co * (-(ry * dx) / rx) + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
  let t1 = ang(1, 0, (dx - co * ((rx * dy) / ry)) / rx, (dy - co * (-(ry * dx) / rx)) / ry);
  let dt = ang((dx - co * ((rx * dy) / ry)) / rx, (dy - co * (-(ry * dx) / rx)) / ry, (-dx - co * ((rx * dy) / ry)) / rx, (-dy - co * (-(ry * dx) / rx)) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI; if (sweep && dt < 0) dt += 2 * Math.PI;
  const segs = Math.ceil(Math.abs(dt) / (Math.PI / 2)), step = dt / segs, out: number[][] = [];
  for (let i = 0; i < segs; i++) {
    const a1 = t1, a2 = t1 + step, al = (4 / 3) * Math.tan((a2 - a1) / 4);
    const p1 = [cx + rx * Math.cos(a1), cy + ry * Math.sin(a1)], p2 = [cx + rx * Math.cos(a2), cy + ry * Math.sin(a2)];
    out.push([p1[0] - al * rx * Math.sin(a1), p1[1] + al * ry * Math.cos(a1), p2[0] + al * rx * Math.sin(a2), p2[1] - al * ry * Math.cos(a2), p2[0], p2[1]]);
    t1 = a2;
  }
  return out;
}

export function buildPrintPdf(pages: PdfPage[], meta: { title: string; producer: string }): Buffer {
  const chunks: Buffer[] = []; const offsets: number[] = []; let size = 0;
  const push = (b: Buffer | string) => { const buf = typeof b === 'string' ? Buffer.from(b, 'latin1') : b; chunks.push(buf); size += buf.length; };
  const obj = (id: number, body: (Buffer | string)[]) => { offsets[id] = size; push(`${id} 0 obj\n`); for (const b of body) push(b); push('\nendobj\n'); };
  push('%PDF-1.6\n%\xE2\xE3\xCF\xD3\n');
  // 1 catalog · 2 pages · 3 info · 4 CutContour · 5 KissCut · 6 Fold (Separation colour spaces, magenta/cyan/green alternates)
  const sep = (name: string, c: number, m: number, y: number, k: number) => `[/Separation /${name} /DeviceCMYK << /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [${c} ${m} ${y} ${k}] /N 1 >>]`;
  let next = 7; const plan = pages.map(() => { const ids = { page: next, content: next + 1, image: next + 2 }; next += 3; return ids; });
  obj(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
  obj(2, [`<< /Type /Pages /Count ${pages.length} /Kids [${plan.map((p) => `${p.page} 0 R`).join(' ')}] >>`]);
  const title = meta.title.replace(/[^\x20-\x7e]/g, '').replace(/[()\\]/g, '').slice(0, 120) || 'Print design';
  obj(3, [`<< /Title (${title}) /Producer (${meta.producer}) /Creator (Future Creative Print Design Studio) >>`]);
  obj(4, [sep('CutContour', 0, 1, 0, 0)]); obj(5, [sep('KissCut', 1, 0, 0, 0)]); obj(6, [sep('Fold', 1, 0, 1, 0)]);
  pages.forEach((p, i) => {
    const ids = plan[i]; const W = p.mediaMm.w * PT, H = p.mediaMm.h * PT, b = p.bleedMm * PT;
    const boxes = p.bleedMm > 0 ? ` /TrimBox [${f2(b)} ${f2(b)} ${f2(W - b)} ${f2(H - b)}] /BleedBox [0 0 ${f2(W)} ${f2(H)}]` : ` /TrimBox [0 0 ${f2(W)} ${f2(H)}]`;
    let stream = `q ${f2(W)} 0 0 ${f2(H)} 0 0 cm /Im0 Do Q`;
    // production vectors: hairline 0.25 pt, overprint (never knock out the artwork)
    const vec = (cs: string, d: string, dash = '') => `\nq /GS0 gs /${cs} CS 1 SCN 0.25 w ${dash} ${pathToPdf(d, p.mediaMm.h)} S Q`;
    if (p.cut) stream += vec('CS1', p.cut);
    for (const kc of p.kissCut ?? []) stream += vec('CS2', kc);
    for (const fx of p.folds ?? []) stream += vec('CS3', `M${fx} 0 V${p.mediaMm.h}`, '[3 2] 0 d');
    for (const fp of p.foldPaths ?? []) stream += vec('CS3', fp, '[3 2] 0 d');
    for (const pp of p.perfPaths ?? []) stream += vec('CS1', pp, '[1 1] 0 d');
    obj(ids.page, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f2(W)} ${f2(H)}]${boxes} /Resources << /XObject << /Im0 ${ids.image} 0 R >> /ColorSpace << /CS1 4 0 R /CS2 5 0 R /CS3 6 0 R >> /ExtGState << /GS0 << /Type /ExtGState /OP true /op true /OPM 1 >> >> >> /Contents ${ids.content} 0 R >>`]);
    obj(ids.content, [`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`]);
    // Adobe-style CMYK JPEGs store inverted values → Decode array
    obj(ids.image, [`<< /Type /XObject /Subtype /Image /Width ${p.widthPx} /Height ${p.heightPx} /ColorSpace /${p.gray ? 'DeviceGray' : p.cmyk ? 'DeviceCMYK /Decode [1 0 1 0 1 0 1 0]' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`, p.jpeg, '\nendstream']);
  });
  const xref = size;
  push(`xref\n0 ${next}\n0000000000 65535 f \n`);
  for (let id = 1; id < next; id++) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${next} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(chunks);
}
