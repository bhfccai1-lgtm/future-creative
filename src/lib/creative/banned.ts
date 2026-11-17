/**
 * Banned phrases (عبارات ممنوعة): slogans that must never appear in an idea, headline, caption or drawn text,
 * e.g. a line from an old ad that keeps leaking. Matching ignores diacritics, tatweel and alef/ya/ta-marbuta forms.
 */
const norm = (t: string) => t
  .replace(/[ً-ٰٟـ]/g, '')
  .replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();

const clean = (list: readonly string[]) => list.map((x) => x.trim()).filter((x) => norm(x).length >= 3);

/** The banned phrases found in `text` (as written in the list). */
export function findBanned(text: string | null | undefined, list: readonly string[]): string[] {
  if (!text) return [];
  const t = ` ${norm(text)} `;
  return clean(list).filter((b) => t.includes(` ${norm(b)} `));
}

/** Removes banned phrases from free text (owner guidance, rejection notes, campaign ideas) before it reaches a model. */
export function stripBanned(text: string, list: readonly string[]): string {
  let out = text;
  for (const b of clean(list)) {
    const words = norm(b).split(' ').map((w) => [...w].map((ch) => {
      const cls = ({ ا: '[اإأآٱ]', ي: '[يىئ]', ه: '[هة]', و: '[وؤ]' } as Record<string, string>)[ch] ?? ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return `${cls}[\\u064B-\\u065F\\u0670\\u0640]*`;
    }).join(''));
    out = out.replace(new RegExp(`[«"“]?${words.join('[^\\p{L}\\p{N}]+')}[»"”]?`, 'giu'), '');
  }
  return out.replace(/[ \t]{2,}/g, ' ').replace(/\s+([،,.!؟])/g, '$1').trim();
}
