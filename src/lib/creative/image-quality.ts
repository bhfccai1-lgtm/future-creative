import sharp, { type Sharp } from 'sharp';

/**
 * IMAGE QUALITY GATE for AI pictures (print studio, EDUCATION MASTER):
 *  - text inside the picture (image models often draw garbled letters despite instructions) — read by a vision model
 *  - real sharpness: the strongest edges relative to the picture's tonal range (style-independent)
 *  - exposure (clipped highlights / shadows) and contrast
 *  - cut-out pictures (transparent): the subject must not touch the borders
 * Each issue is either a FAIL (regenerate) or a NOTE (shown, no regeneration).
 */
export interface ImageQuality {
  sharpness: number | null; mean: number; clippedHigh: number; clippedLow: number; contrast: number; edgeTouch: number | null;
  text: string | null; issues: { code: string; level: 'fail' | 'note'; ar: string }[]; score: number; pass: boolean;
}
export type TextReader = (jpeg: Buffer) => Promise<string>;

/**
 * Sharpness index: the strongest edges (99.9th percentile of the Laplacian) divided by the picture's tonal range
 * (p99 − p1). Sharp art ≈ 0.4–1.0 whatever its style; a soft / hazy picture falls below ~0.2. Dividing by the range keeps
 * pale, low-contrast art from being called soft.
 */
async function sharpnessIndex(g: Sharp, tones: Uint8Array): Promise<number | null> {
  const { data } = await g.clone().convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], offset: 128 }).raw().toBuffer({ resolveWithObject: true });
  const hist = new Uint32Array(129); for (let i = 0; i < data.length; i++) hist[Math.min(128, Math.abs(data[i] - 128))]++;
  let acc = 0, peak = 0; const target = data.length * 0.001; for (let v = 128; v >= 0; v--) { acc += hist[v]; if (acc >= target) { peak = v; break; } }
  const th = new Uint32Array(256); for (let i = 0; i < tones.length; i++) th[tones[i]]++;
  const pct = (q: number) => { let s = 0; const t = tones.length * q; for (let v = 0; v < 256; v++) { s += th[v]; if (s >= t) return v; } return 255; };
  const range = pct(0.99) - pct(0.01);
  if (range < 8) return null; // an almost uniform picture: nothing to judge
  return Math.round((peak / range) * 100) / 100;
}
/** meaningful text the vision model found (ignores "no text" answers and lone illegible marks) */
export function meaningfulText(read: string): string | null {
  const lines = read.split('\n').map((l) => l.replace(/\[\?\]/g, '').trim()).filter(Boolean)
    .filter((l) => !/^(none|no text|no visible text|n\/a|there is no (visible )?text|لا يوجد نص)\.?$/i.test(l))
    .filter((l) => (l.match(/[A-Za-z؀-ۿ0-9]/g) ?? []).length >= 2);
  return lines.length ? lines.join(' · ').slice(0, 160) : null;
}

export async function assessImage(png: Buffer, o: { transparent?: boolean; readText?: TextReader | null } = {}): Promise<ImageQuality> {
  const base = sharp(png).resize({ width: 512, height: 512, fit: 'inside' });
  const issues: ImageQuality['issues'] = [];
  // tones on the visible pixels (flattened on white for cut-outs)
  const grey = base.clone().flatten({ background: '#ffffff' }).greyscale();
  const { data, info } = await grey.clone().raw().toBuffer({ resolveWithObject: true });
  let sum = 0, sq = 0, hi = 0, lo = 0;
  for (let i = 0; i < data.length; i++) { const v = data[i]; sum += v; sq += v * v; if (v >= 250) hi++; if (v <= 5) lo++; }
  const n = data.length, mean = sum / n, contrast = Math.sqrt(Math.max(0, sq / n - mean * mean));
  const clippedHigh = Math.round((hi / n) * 100), clippedLow = Math.round((lo / n) * 100);
  // sharpness: ratio of edge energy before / after a light blur (≈1 = already soft)
  const sharpness = await sharpnessIndex(grey, data);
  if (sharpness !== null && sharpness < 0.2) issues.push({ code: 'soft', level: 'fail', ar: 'الصورة غير حادة (ضبابية)' });
  if (!o.transparent && clippedHigh > 35 && mean > 225) issues.push({ code: 'overexposed', level: 'note', ar: `مناطق بيضاء محترقة كثيرة (${clippedHigh}٪)` });
  if (clippedLow > 30) issues.push({ code: 'underexposed', level: 'note', ar: `مناطق سوداء معتمة كثيرة (${clippedLow}٪)` });
  if (contrast < 16) issues.push({ code: 'flat', level: 'note', ar: 'تباين ضعيف — الصورة باهتة' });
  // cut-outs: the subject must keep a margin from every border
  let edgeTouch: number | null = null;
  if (o.transparent) {
    const a = await base.clone().ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
    const W = a.info.width, H = a.info.height; let touch = 0, tot = 0;
    for (let x = 0; x < W; x++) for (const y of [0, H - 1]) { tot++; if (a.data[y * W + x] > 32) touch++; }
    for (let y = 0; y < H; y++) for (const x of [0, W - 1]) { tot++; if (a.data[y * W + x] > 32) touch++; }
    edgeTouch = Math.round((touch / tot) * 100);
    if (edgeTouch > 4) issues.push({ code: 'cut', level: 'fail', ar: `الموضوع مقصوص عند الحواف (${edgeTouch}٪ من الحدود)` });
    if (edgeTouch > 60) issues.push({ code: 'not_transparent', level: 'fail', ar: 'الخلفية ليست شفافة' });
  }
  let text: string | null = null;
  if (o.readText) {
    try {
      const jpeg = await sharp(png).flatten({ background: '#ffffff' }).resize({ width: 1024, height: 1024, fit: 'inside' }).jpeg({ quality: 85 }).toBuffer();
      text = meaningfulText(await o.readText(jpeg));
      if (text) issues.push({ code: 'text', level: 'fail', ar: `نص داخل الصورة: «${text.slice(0, 60)}»` });
    } catch { issues.push({ code: 'text_unchecked', level: 'note', ar: 'تعذّر فحص النصوص داخل الصورة' }); }
  }
  void info;
  const score = Math.max(0, 100 - issues.reduce((s, i) => s + (i.level === 'fail' ? (i.code === 'text' ? 50 : 30) : 8), 0));
  return { sharpness, mean: Math.round(mean), clippedHigh, clippedLow, contrast: Math.round(contrast), edgeTouch, text, issues, score, pass: !issues.some((i) => i.level === 'fail') };
}

/** the extra instruction for a second attempt, from what failed */
export function retryHint(q: ImageQuality): string {
  const parts = q.issues.filter((i) => i.level === 'fail').map((i) => i.code === 'text' ? 'The previous attempt contained text — this time there must be ZERO letters, numbers, signs or labels anywhere, including on objects, packaging, screens and backgrounds.'
    : i.code === 'soft' ? 'The previous attempt was soft — make it tack-sharp, high detail, crisp edges, no blur or haze.'
    : i.code === 'cut' ? 'The previous attempt cut the subject at the borders — keep the whole subject inside the frame with a clear empty margin on every side.'
    : 'The background must be fully transparent.');
  return parts.length ? ` IMPORTANT: ${parts.join(' ')}` : '';
}
