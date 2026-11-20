/**
 * «النطق الصحيح»: what the voice-over model actually reads.
 *  1. A pronunciation lexicon (built-in brand / local / print-trade terms + the owner's own words): written forms the TTS
 *     model reads wrongly are replaced by a spelling it reads right (diacritics, Arabic spelling of English trade words).
 *  1b. Numbers are spoken as words («٢٠٪» → «عشرين بالمئة», «A4» → «إيه فور») instead of being dropped; long digit runs
 *     (phone numbers) are never read.
 *  2. A listen-back check: the generated audio is transcribed and compared with the script word by word; a low score
 *     triggers one slower, more articulated re-take — with full diacritics added to the words that were not understood
 *     (the words themselves are verified unchanged) — and the better take wins. Scores are recorded — nothing is assumed.
 *  3. Learning: words the voice keeps stumbling on are counted and offered to the owner for the dictionary.
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
  { from: 'إنستغرام', to: 'إِنْسْتَغْرَام' },
  { from: 'انستقرام', to: 'إِنْسْتَغْرَام' },
  { from: 'تيك توك', to: 'تِيك تُوك' },
  { from: 'سناب', to: 'سْنَاب' },
  { from: 'تيشيرت', to: 'تِيشِيرْت' },
  { from: 'تيشيرتات', to: 'تِيشِيرْتَات' },
  { from: 'هودي', to: 'هُودِي' },
  { from: 'كانفس', to: 'كَانْفَس' },
  { from: 'فلكس', to: 'فْلِكْس' },
  { from: 'فينيل', to: 'فِينِيل' },
  { from: 'لوقو', to: 'لُوغُو' },
  { from: 'لوجو', to: 'لُوغُو' },
  { from: 'بروشور', to: 'بْرُوشُور' },
  { from: 'فلاير', to: 'فْلَايَر' },
  { from: 'ديزاين', to: 'دِيزَايْن' },
  { from: 'المحرق', to: 'المُحَرَّق' },
  { from: 'المنامة', to: 'المَنَامَة' },
  { from: 'الرفاع', to: 'الرِّفَاع' },
  { from: 'عالي', to: 'عَالِي' },
  { from: 'PVC', to: 'بِي فِي سِي' },
  { from: 'QR', to: 'كْيُو آر' },
  { from: 'PDF', to: 'بِي دِي إِف' },
  { from: 'CMYK', to: 'سِي إِم وَاي كِي' },
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

// ── numbers as words (the voice model reads digits unreliably; the old behaviour dropped them, breaking the sentence) ──
const AR_ONES = ['صفر', 'واحد', 'اثنين', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة', 'أحد عشر', 'اثني عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const AR_TENS = ['', '', 'عشرين', 'ثلاثين', 'أربعين', 'خمسين', 'ستين', 'سبعين', 'ثمانين', 'تسعين'];
const AR_HUNDREDS = ['', 'مئة', 'مئتين', 'ثلاثمئة', 'أربعمئة', 'خمسمئة', 'ستمئة', 'سبعمئة', 'ثمانمئة', 'تسعمئة'];
function arBelow1000(n: number): string {
  const h = Math.floor(n / 100), r = n % 100;
  const rest = r < 20 ? (r ? AR_ONES[r] : '') : (r % 10 ? `${AR_ONES[r % 10]} و${AR_TENS[Math.floor(r / 10)]}` : AR_TENS[Math.floor(r / 10)]);
  return [h ? AR_HUNDREDS[h] : '', rest].filter(Boolean).join(' و');
}
/** 0 – 999 999 in Arabic words (the forms a Gulf listener hears in ads: «خمسة وعشرين», «ألفين», «ثلاثة آلاف») */
export function arabicNumber(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999) return String(n);
  if (n === 0) return AR_ONES[0];
  const th = Math.floor(n / 1000), r = n % 1000;
  const thousands = !th ? '' : th === 1 ? 'ألف' : th === 2 ? 'ألفين' : th <= 10 ? `${AR_ONES[th]} آلاف` : `${arBelow1000(th)} ألف`;
  return [thousands, r ? arBelow1000(r) : ''].filter(Boolean).join(' و');
}
const EN_ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const enBelow1000 = (n: number) => { const h = Math.floor(n / 100), r = n % 100; const rest = r < 20 ? (r ? EN_ONES[r] : '') : EN_TENS[Math.floor(r / 10)] + (r % 10 ? `-${EN_ONES[r % 10]}` : ''); return [h ? `${EN_ONES[h]} hundred` : '', rest].filter(Boolean).join(' '); };
export function englishNumber(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999) return String(n);
  if (n === 0) return 'zero';
  const th = Math.floor(n / 1000), r = n % 1000;
  return [th ? `${enBelow1000(th)} thousand` : '', r ? enBelow1000(r) : ''].filter(Boolean).join(' ');
}

const toLatinDigits = (t: string) => t.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
/**
 * Numbers as spoken words: «٢٠٪» → «عشرين بالمئة», «2.5» → «اثنين فاصلة خمسة», «150 كوب» → «مئة وخمسين كوب».
 * Long digit runs (5+ digits, also with spaces — phone numbers) are removed: the voice never reads phone numbers.
 * Languages without number words here (e.g. Malayalam) keep their digits for the voice model.
 */
export function spellNumbers(text: string, lang: string): string {
  const word = lang.startsWith('ar') ? arabicNumber : lang.startsWith('en') ? englishNumber : null;
  let t = toLatinDigits(text).replace(/\+?\d[\d\s-]{6,}\d/g, ' ').replace(/\d{5,}/g, ' ');
  if (!word) return t.replace(/\s+/g, ' ').trim();
  const pct = lang.startsWith('ar') ? 'بالمئة' : 'percent', point = lang.startsWith('ar') ? 'فاصلة' : 'point';
  t = t.replace(/(\d+)(?:[.,٫](\d+))?\s*[%٪]/g, (_m, a: string, b?: string) => `${word(Number(a))}${b ? ` ${point} ${[...b].map((d) => word(Number(d))).join(' ')}` : ''} ${pct}`)
    .replace(/(\d+)[.,٫](\d+)/g, (_m, a: string, b: string) => `${word(Number(a))} ${point} ${[...b].map((d) => word(Number(d))).join(' ')}`)
    .replace(/\d+/g, (m) => ` ${word(Number(m))} `);
  return t.replace(/\s+([،,.!؟?])/g, '$1').replace(/\s+/g, ' ').trim();
}

/** what the voice reads: the lexicon first (so «A4» or a brand with digits is matched), then numbers as words */
export function prepareSpoken(script: string, lexicon: LexEntry[], lang: string): string {
  return spellNumbers(applyLexicon(script, lexicon), lang);
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

/** true when two texts have the same words once diacritics and spelling variants are ignored */
export const sameWords = (a: string, b: string) => normalizeForCompare(a).join(' ') === normalizeForCompare(b).join(' ');

/** Words of the script that were not heard (for the owner and for the re-take note). */
export function missedWords(script: string, heard: string): string[] {
  const h = new Set(normalizeForCompare(heard));
  const words = script.split(/\s+/).filter(Boolean);
  return words.filter((w) => { const n = normalizeForCompare(w)[0]; return n && !h.has(n); }).slice(0, 8);
}

export interface Take { audio: Buffer; accuracy: number | null; heard: string | null; pace: 'normal' | 'slow'; text: string }
/**
 * Speak, listen back, and re-take once when the words were not clearly understood.
 * `transcribe` failing never blocks the voice-over (accuracy = null, the take is kept).
 */
export async function speakVerified(script: string, o: {
  speak: (text: string, pace: 'normal' | 'slow', note?: string) => Promise<Buffer>;
  transcribe?: (audio: Buffer) => Promise<string>;
  threshold?: number; pace?: 'normal' | 'slow';
  /** optional: returns the script with full diacritics on the missed words (must keep exactly the same words) */
  fix?: (script: string, missed: string[]) => Promise<string | null>;
}): Promise<{ best: Take; takes: Take[] }> {
  const threshold = o.threshold ?? 0.85;
  const listen = async (audio: Buffer) => { if (!o.transcribe) return { accuracy: null, heard: null }; try { const heard = await o.transcribe(audio); return { heard, accuracy: wordAccuracy(script, heard) }; } catch { return { accuracy: null, heard: null }; } };
  const first: Take = { audio: await o.speak(script, o.pace ?? 'normal'), accuracy: null, heard: null, pace: o.pace ?? 'normal', text: script };
  Object.assign(first, await listen(first.audio));
  const takes = [first];
  if (first.accuracy !== null && first.accuracy < threshold) {
    const missed = missedWords(script, first.heard ?? '');
    const note = `Pronounce every word fully and distinctly, especially: ${missed.join('، ')}.`;
    // the re-take reads a fully vocalised script when the fix keeps exactly the same words (never a different text)
    const fixed = o.fix && missed.length ? await o.fix(script, missed).catch(() => null) : null;
    const text = fixed && sameWords(fixed, script) ? fixed : script;
    const second: Take = { audio: await o.speak(text, 'slow', note), accuracy: null, heard: null, pace: 'slow', text };
    Object.assign(second, await listen(second.audio));
    takes.push(second);
  }
  const best = takes.reduce((x, y) => ((y.accuracy ?? -1) > (x.accuracy ?? -1) ? y : x));
  return { best, takes };
}
