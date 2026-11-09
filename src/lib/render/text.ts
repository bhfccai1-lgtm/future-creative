import sharp from 'sharp';
import { fontFor, missingGlyphs, type Lang, type Weight } from './fonts';

export const escapeMarkup = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export interface TextSpec {
  text: string; lang: Lang; weight: Weight; color: string;
  maxSize: number; minSize: number; boxW: number; boxH: number;
  align?: 'centre' | 'left' | 'right'; maxLines?: number; ltr?: boolean;
}

export interface RenderedText {
  png: Buffer; width: number; height: number; fontSize: number; fits: boolean; missing: string[]; lines: number;
}

/** Cairo has very generous native line metrics, Noto Malayalam does not. */
const lineSpacing = (lang: Lang, size: number) => (lang === 'ml' ? Math.round(size * 0.18) : -Math.round(size * 0.3));

async function pango(markup: string, desc: string, size: number, fontfile: string, width: number | undefined, align: string, spacing: number) {
  return sharp({ text: { text: markup, font: `${desc} ${size}`, fontfile, width, rgba: true, align: align as 'centre', wrap: 'word', dpi: 72, spacing } })
    .png().toBuffer({ resolveWithObject: true });
}

/**
 * Renders a text block through libvips/Pango (HarfBuzz shaping + FriBiDi — correct Arabic joining,
 * RTL ordering and Malayalam conjuncts), shrinking the font until the block fits inside the box with
 * at most `maxLines` lines. `fits=false` means the text cannot be placed without clipping even at
 * the minimum size — callers MUST treat that as a QC failure.
 */
export async function renderText(spec: TextSpec): Promise<RenderedText> {
  const { fontfile, desc } = fontFor(spec.lang, spec.weight);
  const missing = missingGlyphs(spec.text, spec.lang, spec.weight);
  // LRI…PDI isolate so phone digits never reorder inside RTL context.
  const body = spec.ltr ? `⁦${spec.text}⁩` : spec.text;
  const markup = `<span foreground="${spec.color}">${escapeMarkup(body)}</span>`;
  // libvips crops text output to ink bounds, so measure: (a) this exact text unwrapped = one line,
  // (b) the per-line advance from a two-line probe.
  const probe = spec.lang === 'ml' ? 'ക' : spec.lang === 'ar' ? 'ا' : 'H';
  let last: RenderedText | null = null;
  for (let size = spec.maxSize; size >= spec.minSize; size -= 2) {
    const sp = lineSpacing(spec.lang, size);
    const { data, info } = await pango(markup, desc, size, fontfile, spec.boxW, spec.align ?? 'centre', sp);
    const single = await pango(markup, desc, size, fontfile, undefined, 'centre', sp);
    const p1 = await pango(probe, desc, size, fontfile, undefined, 'centre', sp);
    const p2 = await pango(`${probe}\n${probe}`, desc, size, fontfile, undefined, 'centre', sp);
    const lineAdvance = Math.max(1, p2.info.height - p1.info.height);
    const lines = info.height <= single.info.height + lineAdvance * 0.5 ? 1 : 1 + Math.round((info.height - single.info.height) / lineAdvance);
    const trimmed = await sharp(data).trim({ threshold: 1 }).png().toBuffer({ resolveWithObject: true }).catch(() => ({ data, info }));
    const tw = trimmed.info.width, th = trimmed.info.height;
    const fits = tw <= spec.boxW && th <= spec.boxH && (!spec.maxLines || lines <= spec.maxLines);
    last = { png: trimmed.data, width: tw, height: th, fontSize: size, fits, missing, lines };
    if (fits) return last;
  }
  return last!;
}
