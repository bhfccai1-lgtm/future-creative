import { formatInTimeZone } from 'date-fns-tz';
import type { CompetitorPost, CompetitorSummary, OwnPost } from './types';
import { normalizeText } from '../dedup/text';

/**
 * Competitive benchmark + content intelligence. Pure function over normalised data; every figure states its
 * sample size and nothing is filled in when data is missing (shown as null).
 */
export interface BenchRow { handle: string; name?: string; isUs?: boolean; followers: number | null; followerGrowth: number | null; followerGrowthPct: number | null; postsPerWeek: number | null; reelShare: number | null; avgInteractions: number | null; engagementRate: number | null; sample: number }
export interface Slot { hour: number; avgInteractions: number; n: number }
export interface DaySlot { day: string; avgInteractions: number; n: number }
export interface CompetitorAnalysis {
  windowDays: number; competitors: number; posts: number;
  bench: BenchRow[];
  topPosts: (CompetitorPost & { hour: number | null; day: string | null })[];
  formats: { reel: { n: number; avg: number | null }; post: { n: number; avg: number | null }; reelLift: number | null };
  bestSlots: Slot[];
  bestDays: DaySlot[];
  themes: { word: string; topShare: number; count: number }[];
  hashtags: { tag: string; count: number }[];
  gaps: string[];
  opportunities: string[];
}

const DAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const STOP = new Set(['من', 'في', 'على', 'الى', 'إلى', 'عن', 'مع', 'هذا', 'هذه', 'ذلك', 'التي', 'الذي', 'او', 'أو', 'و', 'ثم', 'كل', 'لكل', 'لك', 'لكم', 'لنا', 'نحن', 'انت', 'أنت', 'اللي', 'هو', 'هي', 'ما', 'لا', 'يا', 'قد', 'كان', 'بعد', 'قبل', 'عند', 'the', 'and', 'for', 'with', 'you', 'your', 'our', 'are', 'this', 'that', 'from', 'all', 'now', 'get', 'new', 'بحرين', 'البحرين', 'bahrain', 'اطلب', 'الآن', 'للطلب', 'الطلب', 'تواصل', 'معنا', 'واتساب', 'whatsapp', 'order', 'dm', 'call']);
/** Normalised for matching (ة/ه, أ/ا…), but the first original spelling is remembered for display. */
const SURFACE = new Map<string, string>();
const words = (s: string) => s.replace(/#[^\s#]+/g, ' ').replace(/https?:\/\/\S+/g, ' ').split(/[^\p{L}\p{N}\p{M}]+/u).map((orig) => {
  const w = normalizeText(orig).replace(/\s+/g, '');
  if (w && !SURFACE.has(w)) SURFACE.set(w, orig.replace(/[\u064B-\u0652]/g, ''));
  return w;
}).filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
const shown = (w: string) => SURFACE.get(w) ?? w;
const tags = (s: string) => (s.match(/#[^\s#.,!؟?]+/g) ?? []).map((t) => t.toLowerCase());
const inter = (p: { interactions?: number }) => (typeof p.interactions === 'number' ? p.interactions : null);
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

export function analyseCompetitors(input: {
  now?: Date; windowDays?: number;
  latest: CompetitorSummary[]; previous?: CompetitorSummary[] | null; previousDaysAgo?: number | null;
  posts: CompetitorPost[];
  us?: { name: string; followers?: number | null; posts: OwnPost[] } | null;
}): CompetitorAnalysis {
  const now = input.now ?? new Date();
  const W = input.windowDays ?? 30;
  const since = new Date(now.getTime() - W * 86400_000);
  const posts = input.posts.filter((p) => !p.publishedAt || p.publishedAt >= since);
  const prev = new Map((input.previous ?? []).map((c) => [c.handle, c]));

  const bench: BenchRow[] = input.latest.map((c) => {
    const mine = posts.filter((p) => p.handle === c.handle);
    const ints = mine.map(inter).filter((x): x is number => x !== null);
    const dated = mine.filter((p) => p.publishedAt);
    const p0 = prev.get(c.handle);
    const growth = c.followers !== undefined && p0?.followers !== undefined ? c.followers - p0.followers : null;
    const a = avg(ints);
    return {
      handle: c.handle, name: c.name, followers: c.followers ?? null,
      followerGrowth: growth, followerGrowthPct: growth !== null && p0?.followers ? Math.round((growth / p0.followers) * 1000) / 10 : null,
      postsPerWeek: dated.length ? Math.round((dated.length / (W / 7)) * 10) / 10 : null,
      reelShare: mine.length ? Math.round((mine.filter((p) => p.type === 'reel').length / mine.length) * 100) : null,
      avgInteractions: a, engagementRate: a !== null && c.followers ? Math.round((a / c.followers) * 10000) / 100 : null, sample: mine.length,
    };
  });
  if (input.us) {
    const ups = input.us.posts.filter((p) => p.publishedAt >= since);
    const ints = ups.map(inter).filter((x): x is number => x !== null);
    const a = avg(ints);
    bench.push({ handle: input.us.name, name: 'نحن', isUs: true, followers: input.us.followers ?? null, followerGrowth: null, followerGrowthPct: null, postsPerWeek: ups.length ? Math.round((ups.length / (W / 7)) * 10) / 10 : 0, reelShare: ups.length ? Math.round((ups.filter((p) => p.type === 'reel').length / ups.length) * 100) : null, avgInteractions: a, engagementRate: a !== null && input.us.followers ? Math.round((a / input.us.followers) * 10000) / 100 : null, sample: ups.length });
  }
  bench.sort((x, y) => (y.engagementRate ?? -1) - (x.engagementRate ?? -1) || (y.avgInteractions ?? -1) - (x.avgInteractions ?? -1));

  const withInt = posts.filter((p) => inter(p) !== null);
  const sorted = [...withInt].sort((a, b) => inter(b)! - inter(a)!);
  const topPosts = sorted.slice(0, 10).map((p) => ({ ...p, hour: p.publishedAt ? Number(formatInTimeZone(p.publishedAt, 'Asia/Bahrain', 'H')) : null, day: p.publishedAt ? DAYS_AR[Number(formatInTimeZone(p.publishedAt, 'Asia/Bahrain', 'i')) % 7] : null }));

  const reels = withInt.filter((p) => p.type === 'reel').map((p) => inter(p)!), feed = withInt.filter((p) => p.type === 'post').map((p) => inter(p)!);
  const ra = avg(reels), pa = avg(feed);
  const formats = { reel: { n: reels.length, avg: ra }, post: { n: feed.length, avg: pa }, reelLift: ra !== null && pa ? Math.round((ra / pa) * 10) / 10 : null };

  // hour of day and weekday are analysed separately (a day×hour grid needs far more posts than local accounts publish)
  const byHour = new Map<number, number[]>(), byDay = new Map<number, number[]>();
  for (const p of withInt) if (p.publishedAt) {
    const h = Number(formatInTimeZone(p.publishedAt, 'Asia/Bahrain', 'H')), d = Number(formatInTimeZone(p.publishedAt, 'Asia/Bahrain', 'i')) % 7;
    byHour.set(h, [...(byHour.get(h) ?? []), inter(p)!]); byDay.set(d, [...(byDay.get(d) ?? []), inter(p)!]);
  }
  const bestSlots: Slot[] = [...byHour.entries()].filter(([, xs]) => xs.length >= 3).map(([hour, xs]) => ({ hour, avgInteractions: avg(xs)!, n: xs.length })).sort((a, b) => b.avgInteractions - a.avgInteractions).slice(0, 5);
  const bestDays: DaySlot[] = [...byDay.entries()].filter(([, xs]) => xs.length >= 3).map(([d, xs]) => ({ day: DAYS_AR[d], avgInteractions: avg(xs)!, n: xs.length })).sort((a, b) => b.avgInteractions - a.avgInteractions).slice(0, 3);

  // themes: words over-represented in the top quartile of posts
  const q = Math.max(1, Math.ceil(sorted.length / 4));
  const top = sorted.slice(0, q), all = sorted;
  const cnt = (list: CompetitorPost[]) => { const m = new Map<string, number>(); for (const p of list) for (const w of new Set(words(p.caption))) m.set(w, (m.get(w) ?? 0) + 1); return m; };
  const topC = cnt(top), allC = cnt(all);
  const themes = [...topC.entries()].filter(([w, c]) => c >= 2 && (allC.get(w) ?? 0) >= 2).map(([w, c]) => ({ word: w, topShare: Math.round((c / top.length) * 100), count: allC.get(w)! })).sort((a, b) => b.topShare - a.topShare || b.count - a.count).slice(0, 12);
  const tagC = new Map<string, number>(); for (const p of posts) for (const t of new Set(tags(p.caption))) tagC.set(t, (tagC.get(t) ?? 0) + 1);
  const hashtags = [...tagC.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count).slice(0, 12);

  const ourWords = new Set((input.us?.posts ?? []).flatMap((p) => words(p.caption)));
  const gaps = input.us ? themes.map((t) => t.word).filter((w) => !ourWords.has(w)).slice(0, 8).map(shown) : [];
  for (const t of themes) t.word = shown(t.word);

  // professional opportunities (only when backed by data)
  const opp: string[] = [];
  const comp = bench.filter((b) => !b.isUs);
  const us = bench.find((b) => b.isUs);
  const medPpw = comp.map((b) => b.postsPerWeek).filter((x): x is number => x !== null).sort((a, b) => a - b)[Math.floor(comp.length / 2)];
  if (us && medPpw !== undefined && us.postsPerWeek !== null && us.postsPerWeek < medPpw * 0.7) opp.push(`وتيرة النشر: المنافسون (الوسيط) ينشرون ${medPpw} منشور/أسبوع مقابل ${us.postsPerWeek} لديك — ارفع الاستمرارية قبل أي شيء.`);
  if (formats.reelLift !== null && formats.reel.n >= 5 && formats.post.n >= 5) opp.push(formats.reelLift >= 1.2 ? `الريلز لدى المنافسين تحقق ${formats.reelLift}× تفاعل المنشورات (${formats.reel.n} ريلز مقابل ${formats.post.n} منشور) — اجعل الريلز أساس المزيج.` : `المنشورات لدى المنافسين تتفوق أو تتساوى مع الريلز (${formats.reelLift}×) — لا تهمل الكاروسيل والصور القوية.`);
  if (bestSlots.length) opp.push(`أعلى تفاعل لدى المنافسين في الساعة: ${bestSlots.slice(0, 3).map((s) => `${s.hour}:00 (${s.n} منشور)`).join('، ')}${bestDays.length ? ` · وفي يوم ${bestDays[0].day} (${bestDays[0].n})` : ''} — جرّبها في حملة.`);
  if (gaps.length) opp.push(`مواضيع ناجحة لديهم غير مستخدمة لديك: ${gaps.slice(0, 5).join('، ')} — حوّلها لأفكار أصلية (لا تنسخ).`);
  const fast = comp.filter((b) => b.followerGrowthPct !== null && b.followerGrowthPct >= 5).sort((a, b) => b.followerGrowthPct! - a.followerGrowthPct!)[0];
  if (fast) opp.push(`أسرع منافس نموًا: @${fast.handle} (+${fast.followerGrowthPct}% متابعين${input.previousDaysAgo ? ` خلال ${input.previousDaysAgo} يومًا` : ''}) — ادرس آخر منشوراته الأعلى تفاعلًا.`);
  const leader = comp.find((b) => b.engagementRate !== null);
  if (leader && us?.engagementRate !== null && us?.engagementRate !== undefined && leader.engagementRate! > us.engagementRate * 1.5) opp.push(`معدل تفاعل @${leader.handle} ${leader.engagementRate}% مقابل ${us.engagementRate}% لديك — ركّز على الافتتاحية القوية ودعوات الحفظ والإرسال.`);
  if (!posts.length) opp.push('لا توجد منشورات منافسين في الفترة — تأكد من إضافة المنافسين في Metricool أو استورد ملف CSV.');
  if (sorted.length && sorted.length < 20) opp.push(`العينة صغيرة (${sorted.length} منشور بتفاعل) — اعتبر النتائج اتجاهات.`);

  return { windowDays: W, competitors: input.latest.length, posts: posts.length, bench, topPosts, formats, bestSlots, bestDays, themes, hashtags, gaps, opportunities: opp };
}
