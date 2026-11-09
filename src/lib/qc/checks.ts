import sharp from 'sharp';
import type { LayerManifest } from '../render/compose';
import type { Lang } from '../render/fonts';

export type Severity = 'BLOCKER' | 'WARNING' | 'INFO';
export interface QcCheck { id: string; label: string; passed: boolean; severity: Severity; detail?: string }

// ─── Language / script ───
const SCRIPT = {
  ar: /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/u,
  ml: /[ഀ-ൿ]/u,
  en: /[A-Za-z]/,
};
export function scriptRatio(text: string, lang: Lang) {
  const letters = [...text].filter((c) => /\p{L}/u.test(c));
  if (!letters.length) return 0;
  return letters.filter((c) => SCRIPT[lang].test(c)).length / letters.length;
}
export function checkLanguage(texts: string[], lang: Lang): QcCheck {
  const bad = texts.filter((t) => t.trim() && scriptRatio(t, lang) < 0.85);
  return { id: 'language_match', label: 'لغة الإعلان تطابق لغة الحساب', passed: bad.length === 0, severity: 'BLOCKER', detail: bad.length ? `نص بلغة مختلفة: ${bad.join(' | ')}` : undefined };
}

// ─── Deterministic proofreading lint (no dictionary claims) ───
export function lintText(text: string, lang: Lang): string[] {
  const issues: string[] = [];
  const t = text.trim();
  if (!t) issues.push('نص فارغ');
  if (/\s{2,}/.test(text)) issues.push('مسافات مزدوجة');
  if (/(^|\s)(\p{L}+)\s+\2(?=\s|$)/u.test(t)) issues.push('كلمة مكررة متتالية');
  if (/([!?؟.،,])\1{1,}/.test(t)) issues.push('علامات ترقيم مكررة');
  if (/[�□]/.test(t)) issues.push('رموز غير صالحة');
  if ((t.match(/[(]/g)?.length ?? 0) !== (t.match(/[)]/g)?.length ?? 0)) issues.push('أقواس غير متوازنة');
  if (lang === 'ar' && /[A-Za-z]/.test(t)) issues.push('أحرف لاتينية داخل نص عربي');
  if (lang === 'ar' && /[?,;]/.test(t)) issues.push('علامة ترقيم لاتينية في نص عربي (استخدم ؟ ، ؛)');
  if (lang === 'ar' && /\b(ال ال|اﻻ)/.test(t)) issues.push('تكرار أداة التعريف');
  if (/\p{Script=Arabic}[ഀ-ൿ]|[ഀ-ൿ]\p{Script=Arabic}/u.test(t)) issues.push('خلط أنظمة كتابة');
  return issues;
}

// ─── Unverifiable advertising claims ───
const CLAIM_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\d+([.,]\d+)?\s*(bd|bhd|د\.?\s?ب|دينار|فلس|fils|\$|usd|₹)/iu, label: 'سعر' },
  { re: /(bd|bhd|دينار)\s*\d+/iu, label: 'سعر' },
  { re: /\d+\s*[%٪]/u, label: 'نسبة خصم' },
  { re: /(خصم|تخفيض|تخفيضات|عرض خاص|عروض|مجانا|مجاناً|مجاني|مجانية|ببلاش|الأرخص|أرخص|الأفضل في|الأول في|رقم\s*1|ضمان|نضمن|توصيل)/u, label: 'ادعاء/عرض غير موثق' },
  { re: /(خلال|في)\s*\d+\s*(ساعة|ساعات|يوم|أيام|دقيقة)/u, label: 'مدة تسليم' },
  { re: /\b(discount|sale|free|cheapest|lowest price|best in|#1|number one|guarantee[ds]?|same[- ]day|delivery|offer)\b/i, label: 'claim/offer' },
  { re: /\bwithin\s+\d+\s*(hours?|days?|minutes?)\b/i, label: 'delivery time' },
  { re: /(സൗജന്യ|ഡിസ്കൗണ്ട്|ഓഫർ|ഡെലിവറി|ഏറ്റവും വിലകുറഞ്ഞ)/u, label: 'ഓഫർ/claim' },
];
export function findClaims(text: string): string[] {
  return CLAIM_PATTERNS.filter((p) => p.re.test(text)).map((p) => `${p.label}: «${text.match(p.re)?.[0]}»`);
}

/** Any 8-digit Bahraini-style number in copy must be one of the approved business numbers. */
export function findWrongPhones(text: string, approved: string[]): string[] {
  const nums = text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).match(/(?<!\d)(\+?973[\s-]?)?\d{4}[\s-]?\d{4}(?!\d)/g) ?? [];
  return nums.map((n) => n.replace(/\D/g, '').replace(/^973/, '')).filter((n) => !approved.includes(n));
}

// ─── Layout geometry ───
type Rect = { left: number; top: number; width: number; height: number };
export const intersects = (a: Rect, b: Rect) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

export function checkLayout(m: LayerManifest): QcCheck[] {
  const textLayers = m.layers.filter((l) => l.id !== 'logo');
  const overflow = textLayers.filter((l) => !l.fits).map((l) => l.id);
  const missing = textLayers.filter((l) => l.missing.length).map((l) => `${l.id}: ${l.missing.join(' ')}`);
  const overlaps: string[] = [];
  for (let i = 0; i < m.layers.length; i++) for (let j = i + 1; j < m.layers.length; j++)
    if (intersects(m.layers[i].rect, m.layers[j].rect)) overlaps.push(`${m.layers[i].id} × ${m.layers[j].id}`);
  const margin = 16;
  const outside = m.layers.filter((l) => l.rect.left < margin || l.rect.top < margin || l.rect.left + l.rect.width > m.width - margin || l.rect.top + l.rect.height > m.height - margin).map((l) => l.id);
  return [
    { id: 'text_fit', label: 'النص داخل حدود التصميم دون قص', passed: overflow.length === 0, severity: 'BLOCKER', detail: overflow.length ? `تجاوز: ${overflow.join(', ')}` : undefined },
    { id: 'glyphs', label: 'لا توجد أحرف مفقودة في الخط', passed: missing.length === 0, severity: 'BLOCKER', detail: missing.join('; ') || undefined },
    { id: 'no_overlap', label: 'لا يوجد تداخل بين الطبقات', passed: overlaps.length === 0, severity: 'BLOCKER', detail: overlaps.join(', ') || undefined },
    { id: 'safe_area', label: 'العناصر داخل الهامش الآمن', passed: outside.length === 0, severity: 'BLOCKER', detail: outside.join(', ') || undefined },
  ];
}

// ─── Contrast (WCAG relative luminance) ───
const lum = (r: number, g: number, b: number) => {
  const f = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const hexRgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
export const contrastRatio = (a: [number, number, number], b: [number, number, number]) => {
  const [l1, l2] = [lum(...a), lum(...b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

export async function checkContrast(background: Buffer, m: LayerManifest): Promise<QcCheck> {
  const low: string[] = [];
  for (const l of m.layers) {
    if (!l.color || l.id === 'cta') continue; // CTA sits on its own solid pill (navy on gold ≈ 8:1)
    const r = l.rect;
    if (r.width < 2 || r.height < 2) continue;
    const st = await sharp(background).extract({ left: r.left, top: r.top, width: r.width, height: r.height }).stats();
    const bg: [number, number, number] = [st.channels[0].mean, st.channels[1].mean, st.channels[2].mean];
    const cr = contrastRatio(hexRgb(l.color), bg);
    if (cr < 3) low.push(`${l.id} (${cr.toFixed(1)}:1)`);
  }
  return { id: 'contrast', label: 'تباين كافٍ بين النص والخلفية (≥ 3:1)', passed: low.length === 0, severity: 'BLOCKER', detail: low.join(', ') || undefined };
}

/**
 * Pixel-level logo integrity: the logo region of the exported file must match the expected
 * composite of the approved logo over the background (tolerance for JPEG encoding).
 */
export async function checkLogoPixels(finalImage: Buffer, background: Buffer, logoPng: Buffer, rect: Rect): Promise<QcCheck> {
  const expected = await sharp(background).extract(rect).composite([{ input: logoPng, left: 0, top: 0 }]).removeAlpha().raw().toBuffer();
  const actual = await sharp(finalImage).extract(rect).removeAlpha().raw().toBuffer();
  if (expected.length !== actual.length) return { id: 'logo_pixels', label: 'سلامة الشعار على مستوى البكسل', passed: false, severity: 'BLOCKER', detail: 'أبعاد منطقة الشعار غير متطابقة' };
  let diff = 0; for (let i = 0; i < expected.length; i++) diff += Math.abs(expected[i] - actual[i]);
  const mad = diff / expected.length;
  return { id: 'logo_pixels', label: 'سلامة الشعار على مستوى البكسل', passed: mad < 6, severity: 'BLOCKER', detail: `متوسط الفرق ${mad.toFixed(2)}` };
}
