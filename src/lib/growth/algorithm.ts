/**
 * «مؤشر الخوارزمية» — how well a design fits the ranking signals Instagram has described publicly
 * (Adam Mosseri / Instagram Creators): watch time and the first seconds, sends (DM shares) per reach — the
 * strongest signal for reaching non-followers —, saves, originality (reposted/duplicate content is shown less),
 * keyword search (captions are indexed), Reels for reach to non-followers, consistency and timing.
 * Also the penalties: «engagement bait» (asking for tags / comments / likes in exchange) is demoted.
 * Pure and explainable: every point comes from a rule below; it is a readiness score, not a reach prediction.
 */
import type { MediaFormat } from '@prisma/client';

// Phrases Instagram/Meta treat as engagement bait (tag-, comment-, like-, share- and vote-baiting).
const BAIT: RegExp[] = [
  /(منشن|منشنو|منشني|تاق|تاغ|اعمل تاق|سوّ?و? تاق)\s*(\S+\s*){0,3}(صديق|ربع|خوي|اخو|أخو|اخت|أخت|حد|أحد|احد|شخص)/i,
  /(اكتب|اكتبوا|علّ?ق|علقوا|كومنت)\s*(لنا\s*)?(«|"|')?\s*(نعم|تم|١|1|اي|ايه|إي|أبي|ابي|موافق|👍)/i,
  /(لايك|إعجاب|اعجاب)\s*(إذا|اذا|لو|للي)/i,
  /(شارك|شاركوا|انشر|انشروا)\s*(\S+\s*){0,2}(مع|لـ|ل)\s*\d+/i,
  /(تابع|تابعونا)\s*(واحصل|وادخل|للفوز|عشان تفوز)/i,
  /\b(tag|mention)\s+(a|your|\d+)\s+(friend|friends|person|bestie)/i,
  /\b(comment|type)\s+["'«]?(yes|done|1|me|❤️|🔥)\b/i,
  /\blike\s+(if|this if)\b/i,
  /\bshare\s+(with|to)\s+\d+\b/i,
  /\b(follow|like)\s+for\s+(follow|like)\b/i,
  /\bvote\s+(with|using)\s+(reactions|emojis)\b/i,
];
export const baitPhrases = (caption: string) => caption.split('\n').filter((l) => BAIT.some((rx) => rx.test(l))).map((l) => l.trim());
/** Removes engagement-bait lines (the rest of the caption is kept as written). */
export const stripBait = (caption: string) => caption.split('\n').filter((l) => !BAIT.some((rx) => rx.test(l))).join('\n').replace(/\n{3,}/g, '\n\n').trim();

const SAVE_SHARE = /(احفظ|احفظه|احفظها|حفظ المنشور|أرسل|ارسل|ارسله|أرسلها|ارسلها|شارك|شاركها|لصديق|لربعك|لأحد|لاحد|يحتاج|save|send (it|this)|share (it|this)|someone who)/i;
const LOCATION = /(البحرين|بحرين|المنامة|سار|سلماباد|الرفاع|المحرق|السعودية|الرياض|جدة|الدمام|الخبر|bahrain|manama|saudi|riyadh|jeddah|dammam)/i;
const words = (t: string) => t.trim().split(/\s+/).filter(Boolean);
const norm = (t: string) => t.replace(/[ً-ٟـ]/g, '').replace(/[إأآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').toLowerCase();

export interface AlgoInput {
  format: MediaFormat; caption: string; hashtags: string[]; headline?: string | null;
  reelSeconds?: number | null; slides?: number; duplicate?: boolean;
  /** product name(s) people search for, e.g. «أكواب مطبوعة», «Printed mugs» */
  keywords?: string[];
  /** Bahrain-time hour of the planned post and the account's measured peak hours (omit when unknown) */
  hour?: number | null; peakHours?: number[];
}
export interface AlgoSignal { id: string; label: string; ok: boolean; points: number; max: number; tip?: string }
export interface AlgoScore { score: number; grade: 'A' | 'B' | 'C' | 'D'; signals: AlgoSignal[] }

export function algorithmScore(i: AlgoInput): AlgoScore {
  const sig: AlgoSignal[] = [];
  const add = (id: string, label: string, max: number, ok: boolean | number, tip: string) => {
    const pts = typeof ok === 'number' ? Math.round(max * Math.max(0, Math.min(1, ok))) : ok ? max : 0;
    sig.push({ id, label, ok: pts >= max * 0.99, points: pts, max, tip: pts >= max * 0.99 ? undefined : tip });
  };
  const lines = i.caption.split('\n').map((l) => l.trim()).filter(Boolean);
  const first = lines[0] ?? '';
  const top = norm(lines.slice(0, 2).join(' '));
  const reel = i.format === 'REEL_VIDEO', carousel = i.format === 'IMAGE_CAROUSEL', story = i.format === 'IMAGE_STORY';

  add('reach_format', 'الصيغة تصل لغير المتابعين', 20, reel ? 1 : carousel ? 0.75 : story ? 0.25 : 0.45,
    story ? 'الستوري يصل للمتابعين فقط — للوصول لجمهور جديد انشر ريلز' : 'الريلز هي الصيغة التي توصي بها إنستغرام للوصول لغير المتابعين');
  if (reel) {
    const s = i.reelSeconds ?? 0;
    add('watch_time', 'مدة تناسب المشاهدة الكاملة والتكرار (6–15 ث)', 12, s >= 6 && s <= 15 ? 1 : s > 15 && s <= 30 ? 0.6 : s > 0 ? 0.3 : 0.5, 'مدة المشاهدة الفعلية على حساباتك 3–9 ثوانٍ: ريل 7–12 ثانية يُشاهد كاملًا ويتكرر');
    add('hook', 'افتتاحية قوية في أول ثانيتين (عنوان ≤ 6 كلمات)', 10, words(i.headline ?? '').length > 0 && words(i.headline ?? '').length <= 6, 'اجعل العنوان الظاهر في أول إطار قصيرًا وصادمًا (سؤال أو مفاجأة)');
  } else if (carousel) {
    add('carousel_depth', 'كاروسيل من 4 شرائح أو أكثر (فرصة عرض ثانية)', 12, (i.slides ?? 0) >= 4 ? 1 : (i.slides ?? 0) / 4, 'إنستغرام يعيد عرض الكاروسيل من الشريحة الثانية لمن تجاوز الأولى — 4–7 شرائح مفيدة');
    add('hook', 'غلاف بعنوان قصير يوقف التمرير', 10, words(i.headline ?? '').length > 0 && words(i.headline ?? '').length <= 7, 'عنوان الغلاف 3–7 كلمات');
  } else {
    add('hook', 'عنوان قصير يوقف التمرير', 10, words(i.headline ?? '').length > 0 && words(i.headline ?? '').length <= 7, 'العنوان 3–7 كلمات');
  }
  add('first_line', 'سطر أول يظهر كاملًا قبل «المزيد» (≤ 125 حرفًا)', 6, !!first && [...first].length <= 125, 'اختصر السطر الأول — ما بعد 125 حرفًا يختفي خلف «المزيد»');
  add('sends_saves', 'يدعو بشكل طبيعي للحفظ أو الإرسال لصديق', 12, SAVE_SHARE.test(i.caption), 'الإرسال لصديق أقوى إشارة للوصول لجمهور جديد: «أرسلها لأحد يجهّز لمناسبة» أو «احفظها لطلبك القادم»');
  const bait = baitPhrases(i.caption);
  add('no_bait', 'بدون «طُعم تفاعل» (منشن صديق، اكتب نعم، لايك إذا…)', 12, bait.length === 0, `إنستغرام يقلل وصول المنشورات التي تطلب التفاعل مقابل شيء: احذف «${bait[0] ?? ''}»`);
  const kw = (i.keywords ?? []).map(norm).filter((k) => k.length >= 3);
  const kwHit = kw.some((k) => top.includes(k) || words(k).filter((w) => w.length >= 3).every((w) => top.includes(w)));
  add('search_keyword', 'كلمة البحث (المنتج) في أول سطرين', 8, kw.length ? kwHit : 0.5, `بحث إنستغرام يقرأ النص: اذكر «${i.keywords?.[0] ?? 'المنتج'}» صراحة في أول سطرين`);
  add('search_location', 'المدينة/الدولة في النص (بحث محلي)', 4, LOCATION.test(i.caption), 'أضف «البحرين» أو المنطقة — الناس تبحث «طباعة أكواب البحرين»');
  const n = i.hashtags.length;
  add('hashtags', '3–5 وسوم دقيقة', 6, n >= 3 && n <= 5 ? 1 : n > 0 && n <= 5 ? 0.6 : 0, 'من 3 إلى 5 وسوم دقيقة (حد إنستغرام 5)');
  add('original', 'محتوى أصلي غير مكرر', 10, !i.duplicate, 'المحتوى المكرر أو المعاد نشره يُعرض أقل — غيّر الفكرة أو الصورة');
  if (typeof i.hour === 'number' && i.peakHours?.length) add('timing', 'في ساعة ذروة جمهور الحساب', 6, i.peakHours.includes(i.hour) || i.peakHours.some((h) => Math.abs(h - i.hour!) === 1) ? 1 : 0, `ساعات الذروة لهذا الحساب: ${i.peakHours.slice(0, 4).map((h) => `${h}:00`).join('، ')}`);
  const max = sig.reduce((a, s) => a + s.max, 0), got = sig.reduce((a, s) => a + s.points, 0);
  const score = Math.round((got / Math.max(1, max)) * 100);
  return { score, grade: score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : 'D', signals: sig };
}

const bhHour = (d: Date) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bahrain', hour: '2-digit', hour12: false }).format(d)) % 24;
/** Builds the score input from a stored design (pure — the caller loads the rows). */
export function algoInputFromAd(ad: {
  format: MediaFormat; caption: string | null; headline: string | null; language: string; options: unknown; qcReport: unknown;
  brief?: { hashtags: string[] } | null; product?: { titleAr: string; titleEn: string | null } | null;
  media?: { role: string }[]; jobs?: { scheduledFor: Date; primary: boolean }[];
}, peakHours?: number[]): AlgoInput {
  const o = (ad.options ?? {}) as { reelDuration?: number | null };
  const qc = ad.qcReport as { checks?: { id: string; passed: boolean }[] } | null;
  const job = ad.jobs?.find((j) => j.primary);
  return {
    format: ad.format, caption: ad.caption ?? '', headline: ad.headline, hashtags: ad.brief?.hashtags ?? (ad.caption?.match(/#[^\s#]+/g) ?? []),
    reelSeconds: o.reelDuration ?? null, slides: (ad.media ?? []).filter((m) => m.role === 'SLIDE').length + (ad.format === 'IMAGE_CAROUSEL' ? 1 : 0),
    duplicate: qc?.checks?.some((c) => c.id === 'duplicates' && !c.passed) ?? false,
    keywords: [ad.language === 'ar' ? ad.product?.titleAr : ad.product?.titleEn ?? ad.product?.titleAr].filter((x): x is string => !!x),
    hour: job ? bhHour(job.scheduledFor) : null, peakHours,
  };
}

/**
 * «التصميم حسب مؤشر الخوارزمية» — the ALGORITHM GATE run on every new design BEFORE it is saved: the deterministic
 * signals are fixed automatically (the AI's wording is kept; lines are only removed, split or added), the score is
 * measured before and after, and what could not be fixed safely (format, headline length, reel duration) is reported.
 */
export interface AlgoFitInput {
  format: MediaFormat; lang: string; caption: string; hashtags: string[]; headline: string;
  keyword?: string | null; market?: 'BH' | 'KSA'; reelSeconds?: number | null; slides?: number;
}
export interface AlgoFit {
  caption: string; hashtags: string[];
  before: number; after: number; grade: AlgoScore['grade'];
  fixes: string[]; remaining: { id: string; label: string; tip?: string }[];
}
const tag = (t: string) => `#${t.trim().replace(/^#/, '').replace(/\s+/g, '_')}`;
/** the caption as published: text + the (max 5) hashtags, exactly like buildCaption */
const published = (caption: string, hashtags: string[]) => [caption.trim(), [...new Set(hashtags.map(tag))].slice(0, 5).join(' ')].filter(Boolean).join('\n\n');

export function fitToAlgorithm(i: AlgoFitInput): AlgoFit {
  const ar = i.lang !== 'en';
  const ksa = i.market === 'KSA';
  const place = ksa ? (ar ? 'السعودية' : 'Saudi Arabia') : (ar ? 'البحرين' : 'Bahrain');
  const keywords = i.keyword ? [i.keyword] : [];
  const score = (c: string, h: string[]) => algorithmScore({ format: i.format, caption: published(c, h), hashtags: [...new Set(h.map(tag))].slice(0, 5), headline: i.headline, reelSeconds: i.reelSeconds, slides: i.slides, keywords });
  const before = score(i.caption, i.hashtags).score;
  const fixes: string[] = [];
  let caption = i.caption, hashtags = [...new Set(i.hashtags.map(tag))];

  // 1) engagement bait out
  if (baitPhrases(caption).length) { caption = stripBait(caption); fixes.push('حذف «طُعم التفاعل»'); }
  // 2) the first line must show before «more»: split a long first line at its first sentence break
  let lines = caption.split('\n');
  const fi = lines.findIndex((l) => l.trim());
  if (fi >= 0 && [...lines[fi].trim()].length > 125) {
    const m = lines[fi].trim().match(/^(.{20,125}?[.!؟?،,…])\s+(.+)$/u);
    if (m) { lines.splice(fi, 1, m[1], m[2]); caption = lines.join('\n'); fixes.push('تقسيم السطر الأول ليظهر كاملًا قبل «المزيد»'); }
  }
  // 3) search: product keyword (and the place) in the first two lines
  const s1 = score(caption, hashtags).signals;
  const miss = (id: string) => s1.some((x) => x.id === id && !x.ok);
  if (i.keyword && miss('search_keyword')) {
    lines = caption.split('\n');
    const at = Math.max(0, lines.findIndex((l) => l.trim())) + 1;
    // local search reads the opening too: the place goes with the keyword unless the first two lines already name one
    const withPlace = !LOCATION.test(lines.filter((l) => l.trim()).slice(0, 2).join(' '));
    lines.splice(at, 0, ar ? `✨ ${i.keyword}${withPlace ? ` في ${place}` : ''}` : `✨ ${i.keyword}${withPlace ? ` in ${place}` : ''}`);
    caption = lines.join('\n'); fixes.push(withPlace ? 'إضافة كلمة البحث والمكان في السطر الثاني' : 'إضافة كلمة البحث في السطر الثاني');
  }
  // 4) local search: the place somewhere (a local hashtag is the lightest touch)
  if (!LOCATION.test(published(caption, hashtags))) {
    hashtags = [tag(place.replace(/\s+/g, '')), ...hashtags]; fixes.push(`إضافة وسم المكان ${tag(place.replace(/\s+/g, ''))}`);
  }
  // 5) sends / saves: one natural line before the call to action
  if (!SAVE_SHARE.test(caption)) {
    lines = caption.split('\n');
    const line = i.format === 'IMAGE_CAROUSEL' ? (ar ? 'احفظها لطلبك القادم 📌' : 'Save this for your next order 📌') : (ar ? 'أرسلها لأحد يحتاجها 💌' : 'Send this to someone who needs it 💌');
    // before the last paragraph (the CTA + phones) when there is one, otherwise at the end
    const lastBlank = lines.map((l) => l.trim()).lastIndexOf('');
    if (lastBlank > 0) lines.splice(lastBlank, 0, line); else lines.push(line);
    caption = lines.join('\n'); fixes.push('إضافة دعوة طبيعية للإرسال/الحفظ');
  }
  // 6) 3–5 precise hashtags
  if (hashtags.length > 5) { hashtags = hashtags.slice(0, 5); fixes.push('تقليص الوسوم إلى 5'); }
  if (hashtags.length < 3) {
    const extra = [i.keyword ? tag(i.keyword) : null, tag(place.replace(/\s+/g, ''))].filter((x): x is string => !!x && !hashtags.includes(x));
    const add = extra.slice(0, 3 - hashtags.length);
    if (add.length) { hashtags = [...hashtags, ...add]; fixes.push('إكمال الوسوم إلى 3 على الأقل'); }
  }
  caption = caption.replace(/\n{3,}/g, '\n\n').trim();
  const final = score(caption, hashtags);
  return {
    caption, hashtags, before, after: final.score, grade: final.grade, fixes,
    remaining: final.signals.filter((x) => !x.ok).map((x) => ({ id: x.id, label: x.label, tip: x.tip })),
  };
}
