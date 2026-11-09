import path from 'node:path';
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';

export type Lang = 'ar' | 'en' | 'ml';
export type Weight = 'regular' | 'bold' | 'extrabold';

const FILES: Record<'latin-arabic' | 'malayalam', Record<Weight, { file: string; desc: string }>> = {
  'latin-arabic': {
    regular: { file: 'Cairo_400Regular.ttf', desc: 'Cairo' },
    bold: { file: 'Cairo_700Bold.ttf', desc: 'Cairo Bold' },
    extrabold: { file: 'Cairo_800ExtraBold.ttf', desc: 'Cairo ExtraBold' },
  },
  malayalam: {
    regular: { file: 'NotoSansMalayalam_400Regular.ttf', desc: 'Noto Sans Malayalam' },
    bold: { file: 'NotoSansMalayalam_700Bold.ttf', desc: 'Noto Sans Malayalam Bold' },
    extrabold: { file: 'NotoSansMalayalam_700Bold.ttf', desc: 'Noto Sans Malayalam Bold' },
  },
};

export const fontDir = () => path.resolve(process.env.FONT_DIR ?? './assets/fonts');

export function fontFor(lang: Lang, weight: Weight) {
  const f = FILES[lang === 'ml' ? 'malayalam' : 'latin-arabic'][weight];
  return { fontfile: path.join(fontDir(), f.file), desc: f.desc };
}

const cache = new Map<string, opentype.Font>();
function load(file: string) {
  let f = cache.get(file);
  if (!f) { const b = readFileSync(file); f = opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); cache.set(file, f); }
  return f;
}

// Characters that are layout controls / whitespace rather than glyph-bearing
const IGNORABLE = /[\s‌‍‎‏؜⁦-⁩ـ]/u;

/** Deterministic missing-glyph check: returns every character the embedded font cannot render. */
export function missingGlyphs(text: string, lang: Lang, weight: Weight = 'bold'): string[] {
  const font = load(fontFor(lang, weight).fontfile);
  const missing = new Set<string>();
  for (const ch of text) {
    if (IGNORABLE.test(ch)) continue;
    if (font.charToGlyphIndex(ch) === 0) missing.add(ch);
  }
  return [...missing];
}
