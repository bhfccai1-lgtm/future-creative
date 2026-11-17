import type { AccountInsight, InsightsSnapshot } from './account-insights';

/**
 * «خطة النشر الذكية»: turns the REAL per-account numbers into a posting rhythm and format mix per account.
 * Pure and deterministic (documented rules below). Applying it only changes account settings — it never turns
 * auto-publishing on and never publishes anything; designs still go through approval as before.
 *
 * Tiers (relative to this owner's accounts):
 *  - grow   : big audience (≥ 3× the median followers and ≥ 300, or top-3 with ≥ 300) → every 4 h, up to 4 a day
 *  - steady : everything in between → every 7 h, up to 3 a day
 *  - light  : < 50 followers → every 48 h, 1 a day (3–4 a week), effort goes to the big accounts
 * Mix: Reels-first when Reels reach ≥ 2× images (70/20/10), images-first when images reach more (40/50/10),
 * otherwise the growth default 60/30/10 (Reel / feed / story).
 */
export type Tier = 'grow' | 'steady' | 'light';
export type Mix = { REEL_VIDEO: number; IMAGE_FEED: number; IMAGE_STORY: number };
export interface PlanCurrent { publishIntervalMinutes: number; maxDailyAds: number; formatStrategy: string; formatMix: unknown; publishWindowStart: string; publishWindowEnd: string; autoPublishEnabled: boolean }
export interface PlanRow {
  accountId: string; name: string; followers: number | null; tier: Tier;
  intervalMinutes: number; maxDaily: number; mix: Mix; postsPerDay: number; reasons: string[];
  current: PlanCurrent & { postsPerDay: number }; changed: boolean;
}

export const TIER_RULES: Record<Tier, { interval: number; maxDaily: number; ar: string }> = {
  grow: { interval: 240, maxDaily: 4, ar: 'تنمية سريعة' },
  steady: { interval: 420, maxDaily: 3, ar: 'منتظم' },
  light: { interval: 2880, maxDaily: 1, ar: 'خفيف' },
};
const MIX_REELS: Mix = { REEL_VIDEO: 70, IMAGE_FEED: 20, IMAGE_STORY: 10 };
const MIX_IMAGES: Mix = { REEL_VIDEO: 40, IMAGE_FEED: 50, IMAGE_STORY: 10 };
const MIX_DEFAULT: Mix = { REEL_VIDEO: 60, IMAGE_FEED: 30, IMAGE_STORY: 10 };

const mins = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
/** Length of the daily publishing window in minutes (handles windows that cross midnight). */
export function windowMinutes(start: string, end: string) { const d = mins(end) - mins(start); return d > 0 ? d : d + 1440; }
/** Posts a day the scheduler can actually make with this rhythm (window, interval and daily cap). */
export function postsPerDay(intervalMinutes: number, maxDaily: number, start: string, end: string) {
  if (intervalMinutes >= 1440) return Math.round(Math.min(maxDaily, 1440 / intervalMinutes) * 100) / 100;
  return Math.min(maxDaily, Math.floor(windowMinutes(start, end) / intervalMinutes) + 1);
}

function mixFor(a: AccountInsight): { mix: Mix; reason: string } {
  if (a.reels.count >= 2 && a.posts.count >= 2 && a.posts.avgReach > 0) {
    const x = a.reels.avgReach / a.posts.avgReach;
    if (x >= 2) return { mix: MIX_REELS, reason: `الريلز تصل ×${x.toFixed(1)} من الصور ← ريلز أولًا` };
    if (x < 1) return { mix: MIX_IMAGES, reason: `الصور تصل أكثر من الريلز هنا (${a.posts.avgReach} مقابل ${a.reels.avgReach}) ← صور أكثر` };
    return { mix: MIX_DEFAULT, reason: 'الريلز أفضل قليلًا ← مزيج النمو المعتاد' };
  }
  return { mix: MIX_DEFAULT, reason: 'بيانات الصيغ قليلة ← مزيج النمو المعتاد (ريلز أولًا)' };
}

const sameMix = (raw: unknown, m: Mix) => {
  const r = (raw ?? {}) as Record<string, number>;
  return (Object.keys(m) as (keyof Mix)[]).every((k) => (r[k] ?? 0) === m[k]) && Object.keys(r).filter((k) => r[k] > 0).length === 3;
};

export function buildPostingPlan(snap: InsightsSnapshot, current: Record<string, PlanCurrent>): PlanRow[] {
  const usable = snap.accounts.filter((a) => !a.error && current[a.accountId]);
  const withF = usable.filter((a) => a.followers != null).map((a) => a.followers!).sort((x, y) => x - y);
  const median = withF.length ? withF[Math.floor(withF.length / 2)] : 0;
  const top3 = new Set(usable.filter((a) => a.followers != null).sort((x, y) => y.followers! - x.followers!).slice(0, 3).map((a) => a.accountId));
  return usable.map((a) => {
    const cur = current[a.accountId];
    const f = a.followers;
    const content = a.posts.count + a.reels.count;
    const reasons: string[] = [];
    let tier: Tier = 'steady';
    if (f != null && f >= 300 && (f >= median * 3 || top3.has(a.accountId))) {
      tier = 'grow';
      reasons.push(`${f.toLocaleString('en-US')} متابع — من أكبر حساباتك${content <= 4 ? `، ونُشر عليه ${content} فقط خلال ${snap.days} يومًا` : ''}`);
    } else if (f != null && f < 50) {
      tier = 'light';
      reasons.push(`${f} متابع فقط — يكفي 3–4 منشورات أسبوعيًا مع ستوري ترويج من الحسابات الكبيرة`);
    } else reasons.push(f != null ? `${f.toLocaleString('en-US')} متابع — نشر منتظم يحافظ على الوصول` : 'عدد المتابعين غير متاح — إيقاع منتظم');
    const m = mixFor(a);
    reasons.push(m.reason);
    const rule = TIER_RULES[tier];
    const row: PlanRow = {
      accountId: a.accountId, name: a.name, followers: f, tier, intervalMinutes: rule.interval, maxDaily: rule.maxDaily, mix: m.mix,
      postsPerDay: postsPerDay(rule.interval, rule.maxDaily, cur.publishWindowStart, cur.publishWindowEnd), reasons,
      current: { ...cur, postsPerDay: postsPerDay(cur.publishIntervalMinutes, cur.maxDailyAds, cur.publishWindowStart, cur.publishWindowEnd) },
      changed: false,
    };
    row.changed = cur.publishIntervalMinutes !== rule.interval || cur.maxDailyAds !== rule.maxDaily || cur.formatStrategy !== 'GROWTH_MIX' || !sameMix(cur.formatMix, m.mix);
    return row;
  }).sort((x, y) => (y.followers ?? -1) - (x.followers ?? -1));
}

/** Monthly AI cost of a plan for the accounts that publish automatically (others only cost when a design is requested). */
export function planMonthlyCost(rows: PlanRow[], costOf: (format: keyof Mix) => number, which: 'plan' | 'current', includeAll = false) {
  let total = 0;
  for (const r of rows) {
    if (!includeAll && !r.current.autoPublishEnabled) continue;
    const perDay = which === 'plan' ? r.postsPerDay : r.current.postsPerDay;
    const mix = which === 'plan' ? r.mix : MIX_DEFAULT;
    const perAd = (Object.keys(mix) as (keyof Mix)[]).reduce((s, k) => s + (mix[k] / 100) * costOf(k), 0);
    total += perDay * 30 * perAd;
  }
  return Math.round(total * 100) / 100;
}
