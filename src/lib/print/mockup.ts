import sharp, { type OverlayOptions } from 'sharp';
import type { FamilySpec } from './catalog';
import type { PrintPage } from './render';

/**
 * REALISTIC MOCKUP ENGINE — scenes built from the APPROVED artwork pixels (never re-imagined by an AI), with
 * shadows, surfaces and simple 3D projection (strip-wise cylinder wrap for mugs, affine faces for boxes).
 * A mockup is for display only — never a production file.
 */
const W = 1600, H = 1200;
const trimOf = async (p: PrintPage) => {
  const k = p.dpi / 25.4, b = Math.round(p.bleedMm * k);
  const w = Math.round(p.trimMm.w * k), h = Math.round(p.trimMm.h * k);
  if (!b) return p.png;
  return sharp(p.png).extract({ left: b, top: b, width: Math.min(w, p.widthPx - b), height: Math.min(h, p.heightPx - b) }).png().toBuffer();
};
const fitBox = async (png: Buffer, maxW: number, maxH: number) => { const m = await sharp(png).metadata(); const s = Math.min(maxW / (m.width ?? 1), maxH / (m.height ?? 1)); const w = Math.max(1, Math.round((m.width ?? 1) * s)), h = Math.max(1, Math.round((m.height ?? 1) * s)); return { png: await sharp(png).resize(w, h).png().toBuffer(), w, h }; };
const rounded = async (png: Buffer, w: number, h: number, r: number) => sharp(png).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" fill="#fff"/></svg>`), blend: 'dest-in' }]).png().toBuffer();
async function shadowed(png: Buffer, w: number, h: number, blur = 18, opacity = 0.35, rotate = 0) {
  const pad = blur * 3;
  const sh = await sharp({ create: { width: w + pad * 2, height: h + pad * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#000" fill-opacity="${opacity}"/></svg>`), left: pad + Math.round(blur * 0.4), top: pad + Math.round(blur * 0.8) }]).blur(blur).png().toBuffer();
  let out = await sharp(sh).composite([{ input: png, left: pad, top: pad }]).png().toBuffer();
  if (rotate) out = await sharp(out).rotate(rotate, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const m = await sharp(out).metadata();
  return { png: out, w: m.width ?? 0, h: m.height ?? 0 };
}
const scene = (top: string, bottom: string, extra = '') => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient><radialGradient id="vig" cx="50%" cy="45%" r="75%"><stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.35"/></radialGradient></defs><rect width="${W}" height="${H}" fill="url(#bg)"/>${extra}<rect width="${W}" height="${H}" fill="url(#vig)"/></svg>`);
const label = (txt: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect x="24" y="${H - 64}" width="520" height="40" rx="20" fill="#000" fill-opacity="0.55"/><text x="44" y="${H - 37}" font-family="sans-serif" font-size="20" fill="#fff">${txt}</text></svg>`);
const center = (o: { w: number; h: number }, cx = W / 2, cy = H / 2) => ({ left: Math.round(cx - o.w / 2), top: Math.round(cy - o.h / 2) });

/** mug: the visible half of the wrap mapped onto a cylinder (strip-wise horizontal compression + shading) */
async function mug(art: Buffer) {
  const m = await sharp(art).metadata(); const aw = m.width ?? 1, ah = m.height ?? 1;
  const bodyW = 520, bodyH = Math.round(Math.min(620, bodyW * (ah / (aw / 2)) * 0.9));
  // handle on the right: the viewer sees the first half of the wrap
  const face = await sharp(art).extract({ left: 0, top: 0, width: Math.round(aw * 0.5), height: ah }).resize(1000, bodyH, { fit: 'fill' }).png().toBuffer();
  const N = 80, comps: OverlayOptions[] = [];
  for (let i = 0; i < N; i++) {
    const t1 = -Math.PI / 2 + (i / N) * Math.PI, t2 = -Math.PI / 2 + ((i + 1) / N) * Math.PI;
    const x1 = Math.round(bodyW / 2 + (bodyW / 2) * Math.sin(t1)), x2 = Math.round(bodyW / 2 + (bodyW / 2) * Math.sin(t2));
    const sw = Math.max(1, x2 - x1);
    const sl = Math.min(999, Math.round((i / N) * 1000)); const strip = await sharp(face).extract({ left: sl, top: 0, width: Math.max(1, Math.min(1000 - sl, Math.ceil(1000 / N))), height: bodyH }).resize(sw, bodyH, { fit: 'fill' }).png().toBuffer();
    comps.push({ input: strip, left: x1, top: 0 });
  }
  const shade = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${bodyW}" height="${bodyH}"><defs><linearGradient id="s" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity="0.45"/><stop offset="0.28" stop-color="#fff" stop-opacity="0.18"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/><stop offset="0.85" stop-color="#000" stop-opacity="0.2"/><stop offset="1" stop-color="#000" stop-opacity="0.5"/></linearGradient></defs><rect width="${bodyW}" height="${bodyH}" fill="url(#s)"/></svg>`);
  const body = await sharp({ create: { width: bodyW, height: bodyH, channels: 4, background: '#ffffff' } }).composite([...comps, { input: shade }]).png().toBuffer();
  const ex = 36; // ellipse depth
  const cup = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${bodyW + 200}" height="${bodyH + ex * 2}"><path d="M${bodyW + 10} ${bodyH * 0.22} C ${bodyW + 190} ${bodyH * 0.2} ${bodyW + 190} ${bodyH * 0.78} ${bodyW + 10} ${bodyH * 0.72}" fill="none" stroke="#e5e7eb" stroke-width="44"/><path d="M${bodyW + 10} ${bodyH * 0.22} C ${bodyW + 190} ${bodyH * 0.2} ${bodyW + 190} ${bodyH * 0.78} ${bodyW + 10} ${bodyH * 0.72}" fill="none" stroke="#9ca3af" stroke-opacity="0.5" stroke-width="6"/><ellipse cx="${bodyW / 2}" cy="${bodyH + ex}" rx="${bodyW / 2}" ry="${ex}" fill="#d1d5db"/><ellipse cx="${bodyW / 2}" cy="${ex}" rx="${bodyW / 2}" ry="${ex}" fill="#f3f4f6" stroke="#d1d5db" stroke-width="3"/><ellipse cx="${bodyW / 2}" cy="${ex + 4}" rx="${bodyW / 2 - 18}" ry="${ex - 10}" fill="#4b5563"/></svg>`);
  const all = await sharp({ create: { width: bodyW + 200, height: bodyH + ex * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: cup }, { input: body, left: 0, top: ex }, { input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${bodyW + 200}" height="${bodyH + ex * 2}"><ellipse cx="${bodyW / 2}" cy="${ex}" rx="${bodyW / 2}" ry="${ex}" fill="#f3f4f6" stroke="#d1d5db" stroke-width="3"/><ellipse cx="${bodyW / 2}" cy="${ex + 4}" rx="${bodyW / 2 - 18}" ry="${ex - 10}" fill="#374151"/></svg>`) }]).png().toBuffer();
  return { png: all, w: bodyW + 200, h: bodyH + ex * 2 };
}

/** pseudo-3D box: front face = artwork, side & top faces sheared and darker */
async function box(art: Buffer) {
  const f = await fitBox(art, 560, 560); const d = Math.round(f.w * 0.42);
  const side = await sharp(f.png).resize(d, f.h, { fit: 'fill' }).modulate({ brightness: 0.72 }).affine([[1, 0], [-0.5, 1]], { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const top = await sharp(f.png).resize(f.w, Math.round(d * 0.5), { fit: 'fill' }).modulate({ brightness: 1.12 }).affine([[1, -1], [0, 1]], { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const sm = await sharp(side).metadata(), tm = await sharp(top).metadata();
  const cw = f.w + (sm.width ?? 0), ch = f.h + (tm.height ?? 0);
  return { png: await sharp({ create: { width: cw, height: ch, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: top, left: 0, top: 0 }, { input: side, left: f.w, top: Math.max(0, (tm.height ?? 0) - Math.round(d * 0.5)) }, { input: f.png, left: 0, top: tm.height ?? 0 }]).png().toBuffer(), w: cw, h: ch };
}

export async function buildMockup(kind: FamilySpec['mockup'], pages: PrintPage[]): Promise<Buffer> {
  const front = await trimOf(pages[0]), back = pages[1] && !pages[1].note ? await trimOf(pages[1]) : null;
  const layers: OverlayOptions[] = [];
  let bg: Buffer;
  if (kind === 'cards') {
    bg = scene('#3f3a36', '#1f1c1a', `<rect width="${W}" height="${H}" fill="#000" fill-opacity="0.05"/>`);
    const a = await fitBox(front, 640, 420), ra = await rounded(a.png, a.w, a.h, 10);
    const sa = await shadowed(ra, a.w, a.h, 16, 0.5, -8); layers.push({ input: sa.png, ...center(sa, W * 0.38, H * 0.45) });
    if (back) { const b = await fitBox(back, 640, 420), rb = await rounded(b.png, b.w, b.h, 10); const sb = await shadowed(rb, b.w, b.h, 16, 0.5, 6); layers.push({ input: sb.png, ...center(sb, W * 0.64, H * 0.58) }); }
  } else if (kind === 'rollup') {
    bg = scene('#f8fafc', '#cbd5e1', `<rect y="${H * 0.78}" width="${W}" height="${H * 0.22}" fill="#94a3b8" fill-opacity="0.35"/>`);
    const a = await fitBox(front, 520, 1000); const x = W / 2 - a.w / 2, y = H * 0.06;
    layers.push({ input: (await shadowed(a.png, a.w, a.h, 14, 0.3)).png, left: Math.round(x - 42), top: Math.round(y - 42) });
    layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect x="${x - 20}" y="${y + a.h - 10}" width="${a.w + 40}" height="46" rx="10" fill="#9ca3af"/><rect x="${x - 20}" y="${y + a.h + 26}" width="${a.w + 40}" height="10" fill="#6b7280"/><rect x="${x - 4}" y="${y - 6}" width="${a.w + 8}" height="12" rx="4" fill="#6b7280"/></svg>`) });
  } else if (kind === 'mug') {
    bg = scene('#fff7ed', '#e7d7c5', `<rect y="${H * 0.72}" width="${W}" height="${H * 0.28}" fill="#c8b39a" fill-opacity="0.6"/>`);
    const m = await mug(pages[0].png); const s = await shadowed(m.png, m.w, m.h, 20, 0.0); layers.push({ input: s.png, ...center(s, W / 2, H * 0.5) });
  } else if (kind === 'box' || kind === 'bag') {
    bg = scene('#e5e7eb', '#9ca3af');
    // with a real dieline: the front panel as the box face (pixels of the approved flat), otherwise the whole artwork
    const fr = pages[0].frontRect;
    const face = fr ? await sharp(pages[0].png).extract({ left: fr.x, top: fr.y, width: Math.min(fr.w, pages[0].widthPx - fr.x), height: Math.min(fr.h, pages[0].heightPx - fr.y) }).flatten({ background: '#ffffff' }).png().toBuffer() : front;
    const b = await box(face); layers.push({ input: (await shadowed(b.png, b.w, b.h, 24, 0.0)).png, ...center({ w: b.w + 144, h: b.h + 144 }) });
  } else if (kind === 'stickers' || kind === 'label' || kind === 'stamp') {
    bg = scene('#f1f5f9', '#cbd5e1');
    const a = await fitBox(front, 340, 340);
    for (const [i, [cx, cy, r]] of ([[0.3, 0.38, -12], [0.55, 0.32, 8], [0.42, 0.66, 4], [0.7, 0.62, -6]] as const).entries()) { const s = await shadowed(a.png, a.w, a.h, 10, i % 2 ? 0.25 : 0.3, r); layers.push({ input: s.png, ...center(s, W * cx, H * cy) }); }
  } else if (kind === 'tshirt' || kind === 'cap' || kind === 'tote') {
    const shirt = '#1f2937';
    bg = scene('#f3f4f6', '#d1d5db', `<path d="M560 160 L700 120 Q800 190 900 120 L1040 160 L1260 330 L1150 470 L1060 410 L1060 1100 L540 1100 L540 410 L450 470 L340 330 Z" fill="${shirt}"/><path d="M700 120 Q800 230 900 120" fill="none" stroke="#111827" stroke-width="10"/>`);
    const a = await fitBox(pages[0].png, 380, 440); layers.push({ input: a.png, ...center(a, W / 2, 520) });
  } else if (kind === 'canvas') {
    bg = scene('#ece7df', '#d6cfc4', `<rect y="${H * 0.86}" width="${W}" height="${H * 0.14}" fill="#8b6f4e" fill-opacity="0.5"/>`);
    const a = await fitBox(front, 700, 860); const s = await shadowed(a.png, a.w, a.h, 26, 0.45); layers.push({ input: s.png, ...center(s, W / 2, H * 0.45) });
  } else if (kind === 'book') {
    bg = scene('#e2e8f0', '#94a3b8');
    const k = pages[0].dpi / 25.4, half = Math.round(((pages[0].trimMm.w - (pages[0].folds?.length === 2 ? pages[0].folds[1] - pages[0].folds[0] : 0)) / 2) * k);
    const fx = pages[0].folds?.length === 2 ? Math.round((pages[0].folds[1]) * k) : Math.round((pages[0].bleedMm * k) + half);
    const fr = await sharp(pages[0].png).extract({ left: Math.min(fx, pages[0].widthPx - 2), top: 0, width: Math.max(1, Math.min(half, pages[0].widthPx - fx)), height: pages[0].heightPx }).png().toBuffer();
    const a = await fitBox(fr, 560, 820); const s = await shadowed(a.png, a.w, a.h, 22, 0.45, -3); layers.push({ input: s.png, ...center(s) });
  } else {
    bg = scene('#e5e7eb', '#a8b0bb');
    const a = await fitBox(front, kind === 'brochure' ? 1100 : 760, 900); const s = await shadowed(a.png, a.w, a.h, 22, 0.4, kind === 'flat' ? 0 : -2); layers.push({ input: s.png, ...center(s) });
  }
  layers.push({ input: label('MOCKUP — display only, not a production file') });
  return sharp(bg).composite(layers).jpeg({ quality: 88 }).toBuffer();
}
