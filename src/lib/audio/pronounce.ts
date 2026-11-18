/**
 * «النطق الصحيح»: what the voice-over model actually reads.
 *  1. A pronunciation lexicon (built-in brand / local / print-trade terms + the owner's own words): written forms the TTS
 *     model reads wrongly are replaced by a spelling it reads right (diacritics, Arabic spelling of English trade words).
 *  2. A listen-back check: the generated audio is transcribed and compared with the script word by word; a low score
 *     triggers one slower, more articulated re-take and the better take wins. Scores are recorded — nothing is assumed.
 */
export interface LexEntry { from: string; to: string }

/** Terms the voice model tends to mispronounce in our ads (brand, branches, print trade, English loan words). */
export const BUILTIN_LEXICON: LexEntry[] = [
  { from: 'إبداع المستقبل', to: 'إِبْدَاعِ المُسْتَقْبَل' },
  { from: 'سلماباد', to: 'سَلْمَابَاد' },
  { from: 'سار', to: 'سَار' },
  { from: 'البحرين', to: 'البَحْرَيْن' },
  { from: 'مطبعة', to: 'مَطْبَعَة' },
  { from: 'مطبوع', to: 'مَطْبُوع' },
  { from: 'مطبوعة', to: 'مَطْبُوعَة' },
  { from: 'ملصقات', to: 'مُلْصَقَات' },
  { from: 'ملصق', to: 'مُلْصَق' },
  { from: 'رول أب', to: 'رُولْ أَبْ' },
  { from: 'ستيكرات', to: 'سْتِيكَرَات' },
  { from: 'بنرات', to: 'بَنَرَات' },
  { from: 'بنر', to: 'بَنَر' },
  { from: 'كاروسيل', to: 'كَارُوسِيل' },
  { from: 'ريلز', to: 'رِيلْز' },
  { from: 'واتساب', to: 'وَاتْسَاب' },
  { from: 'الواتساب', to: 'الوَاتْسَاب' },
  { from: 'الحين', to: 'الحِين' },
  { from: 'تبي', to: 'تِبِي' },
  { from: 'أكواب', to: 'أَكْوَاب' },
  { from: 'كوب', to: 'كُوب' },
  { from: 'أختام', to: 'أَخْتَام' },
  { from: 'ختم', to: 'خَتْم' },
  { from: 'DTF', to: 'دِي تِي إِف' },
  { from: 'UV', to: 'يُو فِي' },
  { from: 'A4', to: 'إِيه فُور' },
  { from: 'A3', to: 'إِيه ثْرِي' },
];

const AR_LETTER = '\\u0621-\\u064A\\u0671-\\u06D3\\u064B-\\u0652';
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Replaces whole words / phrases only (never inside a longer word); the owner's entries win over the built-in ones. */
export function applyLexicon(text: string, entries: LexEntry[]): string {
  const seen = new Set<string>();
  const all = [...entries, ...BUILTIN_LEXICON].filter((e) => e.from.trim() && e.to.trim() && !seen.has(e.from) && seen.add(e.from))
    .sort((a, b) => b.from.length - a.from.length); // longest phrase first
  let out = text;
  for (const e of all) {
    const latin = /^[\x20-\x7E]+$/.test(e.from);
    const rx = latin ? new RegExp(`\\b${esc(e.from)}\\b`, 'gi') : new RegExp(`(^|[^${AR_LETTER}])(${esc(e.from)})(?=$|[^${AR_LETTER}])`, 'g');
    out = latin ? out.replace(rx, e.to) : out.replace(rx, (_m, pre: string) => `${pre}${e.to}`);
  }
  return out;
}

/** Arabic-aware comparison form: no diacritics/tatweel, unified alef/ya/ta-marbuta/hamza seats, Latin lower-case. */
export function normalizeForCompare(t: string): string[] {
  return t.normalize('NFKC').toLowerCase()
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
}

/** Share of the script's words heard in order (LCS / script length), 0–1. */
export function wordAccuracy(script: string, heard: string): number {
  const a = normalizeForCompare(script), b = normalizeForCompare(heard);
  if (!a.length) return 1;
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return Math.round((dp[a.length][b.length] / a.length) * 100) / 100;
}

/** Words of the script that were not heard (for the owner and for the re-take note). */
export function missedWords(script: string, heard: string): string[] {
  const h = new Set(normalizeForCompare(heard));
  const words = script.split(/\s+/).filter(Boolean);
  return words.filter((w) => { const n = normalizeForCompare(w)[0]; return n && !h.has(n); }).slice(0, 8);
}

export interface Take { audio: Buffer; accuracy: number | null; heard: string | null; pace: 'normal' | 'slow' }
/**
 * Speak, listen back, and re-take once when the words were not clearly understood.
 * `transcribe` failing never blocks the voice-over (accuracy = null, the take is kept).
 */
export async function speakVerified(script: string, o: {
  speak: (text: string, pace: 'normal' | 'slow', note?: string) => Promise<Buffer>;
  transcribe?: (audio: Buffer) => Promise<string>;
  threshold?: number; pace?: 'normal' | 'slow';
}): Promise<{ best: Take; takes: Take[] }> {
  const threshold = o.threshold ?? 0.85;
  const listen = async (audio: Buffer) => { if (!o.transcribe) return { accuracy: null, heard: null }; try { const heard = await o.transcribe(audio); return { heard, accuracy: wordAccuracy(script, heard) }; } catch { return { accuracy: null, heard: null }; } };
  const first: Take = { audio: await o.speak(script, o.pace ?? 'normal'), accuracy: null, heard: null, pace: o.pace ?? 'normal' };
  Object.assign(first, await listen(first.audio));
  const takes = [first];
  if (first.accuracy !== null && first.accuracy < threshold) {
    const note = `Pronounce every word fully and distinctly, especially: ${missedWords(script, first.heard ?? '').join('، ')}.`;
    const second: Take = { audio: await o.speak(script, 'slow', note), accuracy: null, heard: null, pace: 'slow' };
    Object.assign(second, await listen(second.audio));
    takes.push(second);
  }
  const best = takes.reduce((x, y) => ((y.accuracy ?? -1) > (x.accuracy ?? -1) ? y : x));
  return { best, takes };
}
