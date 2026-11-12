/** Normalisation + similarity helpers for duplicate detection (Arabic-aware). */

const AR_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;

export function normalizeText(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(AR_DIACRITICS, '')
    .replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'with', 'your', 'you', 'من', 'في', 'على', 'الى', 'إلى', 'مع', 'و', 'لكل', 'كل', 'عن']);

export function tokens(s: string): string[] {
  return normalizeText(s).split(' ').filter((t) => t.length > 1 && !STOP.has(t));
}

function trigrams(s: string): Set<string> {
  const n = ` ${normalizeText(s)} `;
  const out = new Set<string>();
  for (let i = 0; i < n.length - 2; i++) out.add(n.slice(i, i + 3));
  return out;
}

const jaccard = <T>(a: Set<T>, b: Set<T>) => {
  if (!a.size && !b.size) return 1;
  let inter = 0; for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
};

/** Combined lexical similarity in [0,1]: max of token-set and character-trigram Jaccard. */
export function similarity(a: string, b: string): number {
  return Math.max(jaccard(new Set(tokens(a)), new Set(tokens(b))), jaccard(trigrams(a), trigrams(b)));
}

/** Canonical idea key: product + sorted salient tokens of the concept. */
export function ideaFingerprint(productSlug: string, idea: string, ideaKey: string) {
  const t = [...new Set([...tokens(ideaKey.replace(/[-_|]/g, ' ')), ...tokens(idea)])].sort().slice(0, 16);
  return `${productSlug}::${t.join(' ')}`;
}
