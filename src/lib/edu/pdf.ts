/**
 * Minimal, dependency-free PDF writer: one full-page JPEG per page at the exact paper size (points = mm × 72 / 25.4).
 * The pages are the same 300-DPI renders as the PNG/JPG exports (identical to the preview). With bleed, MediaBox
 * includes the bleed and TrimBox marks the finished size. Colour is RGB (DeviceRGB) — not a CMYK/ICC press file.
 */
export interface PdfPage { jpeg: Buffer; widthPx: number; heightPx: number; trimMm: { w: number; h: number }; bleedMm: number }
const PT = 72 / 25.4;
const n2 = (v: number) => (Math.round(v * 100) / 100).toString();

export function buildPdf(pages: PdfPage[], meta: { title: string }): Buffer {
  const chunks: Buffer[] = []; const offsets: number[] = []; let size = 0;
  const push = (b: Buffer | string) => { const buf = typeof b === 'string' ? Buffer.from(b, 'latin1') : b; chunks.push(buf); size += buf.length; };
  const obj = (id: number, body: (Buffer | string)[]) => { offsets[id] = size; push(`${id} 0 obj\n`); for (const b of body) push(b); push('\nendobj\n'); };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const pageIds: number[] = [];
  // ids: 1 catalog, 2 pages, 3 info, then per page: page, content, image
  let next = 4;
  const plan = pages.map(() => { const ids = { page: next, content: next + 1, image: next + 2 }; next += 3; pageIds.push(ids.page); return ids; });
  obj(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
  obj(2, [`<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] >>`]);
  const title = meta.title.replace(/[^\x20-\x7e]/g, '').replace(/[()\\]/g, '').slice(0, 120) || 'Education Master';
  obj(3, [`<< /Title (${title}) /Producer (EDUCATION MASTER AI V4.0) /Creator (Future Creative) >>`]);
  pages.forEach((p, i) => {
    const ids = plan[i];
    const W = (p.trimMm.w + 2 * p.bleedMm) * PT, H = (p.trimMm.h + 2 * p.bleedMm) * PT, b = p.bleedMm * PT;
    const trim = p.bleedMm > 0 ? ` /TrimBox [${n2(b)} ${n2(b)} ${n2(W - b)} ${n2(H - b)}] /BleedBox [0 0 ${n2(W)} ${n2(H)}]` : '';
    obj(ids.page, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n2(W)} ${n2(H)}]${trim} /Resources << /XObject << /Im0 ${ids.image} 0 R >> >> /Contents ${ids.content} 0 R >>`]);
    const stream = `q ${n2(W)} 0 0 ${n2(H)} 0 0 cm /Im0 Do Q`;
    obj(ids.content, [`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`]);
    obj(ids.image, [`<< /Type /XObject /Subtype /Image /Width ${p.widthPx} /Height ${p.heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`, p.jpeg, '\nendstream']);
  });
  const xref = size;
  push(`xref\n0 ${next}\n0000000000 65535 f \n`);
  for (let id = 1; id < next; id++) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${next} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(chunks);
}

/** Re-reads a PDF made here: page count, every page size in mm, xref offsets valid — used by quality control. */
export function inspectPdf(pdf: Buffer): { ok: boolean; pages: { wMm: number; hMm: number }[]; problems: string[] } {
  const s = pdf.toString('latin1'); const problems: string[] = [];
  if (!s.startsWith('%PDF-')) problems.push('لا يبدأ بترويسة PDF');
  if (!s.trimEnd().endsWith('%%EOF')) problems.push('نهاية الملف مفقودة');
  const sx = s.lastIndexOf('startxref'); const xrefAt = sx >= 0 ? Number(s.slice(sx + 9).trim().split(/\s+/)[0]) : -1;
  if (!(xrefAt > 0 && s.slice(xrefAt, xrefAt + 4) === 'xref')) problems.push('جدول المراجع (xref) غير صالح');
  else {
    const lines = s.slice(xrefAt).split('\n'); const count = Number(lines[1]?.split(' ')[1] ?? 0);
    for (let i = 1; i < count; i++) { const off = Number(lines[2 + i]?.slice(0, 10)); if (!(off >= 0 && s.slice(off).startsWith(`${i} 0 obj`))) { problems.push(`الكائن ${i} في موضع خاطئ`); break; } }
  }
  const pages = [...s.matchAll(/\/Type \/Page \/Parent[^>]*\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map((m) => ({ wMm: Math.round((Number(m[1]) / PT) * 10) / 10, hMm: Math.round((Number(m[2]) / PT) * 10) / 10 }));
  const count = Number(s.match(/\/Type \/Pages \/Count (\d+)/)?.[1] ?? -1);
  if (count !== pages.length) problems.push(`عدد الصفحات المعلن ${count} لا يطابق ${pages.length}`);
  return { ok: problems.length === 0 && pages.length > 0, pages, problems };
}
