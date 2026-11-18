import { prisma } from '../db';
import type { PublishingAdapter } from '../publishing/types';
import type { ProviderPostMetrics } from '../publishing/metricool';
import { log } from '../ops/log';

/**
 * «تحليلات الحسابات»: REAL per-account numbers from Metricool (read-only) for the last 30 days — followers, content
 * by format, reach, interactions, best posts — plus deterministic recommendations derived from those numbers only.
 * Cached in system_settings (refreshed by the button or the daily analytics job); never invented.
 */
export interface FormatStats { count: number; reach: number; avgReach: number; interactions: number }
export interface AccountInsight {
  accountId: string; name: string; handle: string | null; followers: number | null;
  posts: FormatStats; reels: FormatStats; saves: number; shares: number;
  best: { url?: string; kind: string; reach: number; publishedAt?: string }[];
  systemPublished: number; error?: string;
}
export interface Advice { level: 'critical' | 'high' | 'medium' | 'good'; title: string; detail: string; accounts: string[] }
export interface InsightsSnapshot { at: string; days: number; accounts: AccountInsight[]; totals: { followers: number; reach: number; content: number; interactions: number; reelAvg: number; postAvg: number }; advice: Advice[] }

const KEY = 'analytics:accounts';
const fmt = (rows: ProviderPostMetrics[]): FormatStats => {
  const reach = rows.reduce((a, r) => a + (r.reach ?? 0), 0);
  const interactions = rows.reduce((a, r) => a + (r.likes ?? 0) + (r.comments ?? 0) + (r.saves ?? 0) + (r.shares ?? 0), 0);
  return { count: rows.length, reach, avgReach: rows.length ? Math.round((reach / rows.length) * 10) / 10 : 0, interactions };
};

export async function collectAccountInsights(adapter: PublishingAdapter & { followers?: (b: string, f: Date, t: Date, tz?: string) => Promise<number | null> }, opts: { days?: number; now?: Date } = {}): Promise<InsightsSnapshot> {
  const days = opts.days ?? 30, now = opts.now ?? new Date(), from = new Date(now.getTime() - days * 86400_000);
  const accounts = await prisma.socialAccount.findMany({ where: { connection: { providerBrandId: { not: null } } }, include: { connection: true }, orderBy: { name: 'asc' } });
  const published = await prisma.publicationJob.groupBy({ by: ['accountId'], _count: true, where: { state: 'PUBLISHED', scheduledFor: { gte: from } } });
  const out: AccountInsight[] = [];
  for (const a of accounts) {
    const b = a.connection!.providerBrandId!;
    const base: AccountInsight = { accountId: a.id, name: a.name, handle: a.handle, followers: null, posts: fmt([]), reels: fmt([]), saves: 0, shares: 0, best: [], systemPublished: published.find((p) => p.accountId === a.id)?._count ?? 0 };
    try {
      const [posts, reels, followers] = await Promise.all([
        adapter.listPostMetrics ? adapter.listPostMetrics(b, 'posts', from, now, a.timezone) : Promise.resolve([]),
        adapter.listPostMetrics ? adapter.listPostMetrics(b, 'reels', from, now, a.timezone) : Promise.resolve([]),
        adapter.followers ? adapter.followers(b, from, now, a.timezone) : Promise.resolve(null),
      ]);
      const all = [...posts, ...reels];
      out.push({
        ...base, followers, posts: fmt(posts), reels: fmt(reels),
        saves: all.reduce((x, r) => x + (r.saves ?? 0), 0), shares: all.reduce((x, r) => x + (r.shares ?? 0), 0),
        best: all.filter((r) => (r.reach ?? 0) > 0).sort((x, y) => (y.reach ?? 0) - (x.reach ?? 0)).slice(0, 3).map((r) => ({ url: r.url, kind: r.kind, reach: r.reach ?? 0, publishedAt: r.publishedAt?.toISOString() })),
      });
    } catch (e) {
      log.warn('account_insights.failed', { account: a.name, error: (e as Error).message });
      out.push({ ...base, error: (e as Error).message.slice(0, 160) });
    }
  }
  return buildSnapshot(out, days, now);
}

export function buildSnapshot(accounts: AccountInsight[], days: number, now = new Date()): InsightsSnapshot {
  const sum = (f: (a: AccountInsight) => number) => accounts.reduce((x, a) => x + f(a), 0);
  const reelCount = sum((a) => a.reels.count), postCount = sum((a) => a.posts.count);
  const totals = {
    followers: sum((a) => a.followers ?? 0), reach: sum((a) => a.posts.reach + a.reels.reach), content: reelCount + postCount,
    interactions: sum((a) => a.posts.interactions + a.reels.interactions),
    reelAvg: reelCount ? Math.round((sum((a) => a.reels.reach) / reelCount) * 10) / 10 : 0,
    postAvg: postCount ? Math.round((sum((a) => a.posts.reach) / postCount) * 10) / 10 : 0,
  };
  return { at: now.toISOString(), days, accounts, totals, advice: adviseFrom(accounts, totals) };
}

/** Deterministic rules on the real numbers only (no guesses when data is missing). */
export function adviseFrom(accounts: AccountInsight[], totals: InsightsSnapshot['totals']): Advice[] {
  const advice: Advice[] = [];
  const content = (a: AccountInsight) => a.posts.count + a.reels.count;
  const withF = accounts.filter((a) => a.followers !== null);
  if (withF.length >= 3 && totals.followers > 0) {
    // «big» relative to this owner's accounts: ≥ 5× the median follower count (and at least 100)
    const sorted = withF.map((a) => a.followers ?? 0).sort((x, y) => x - y);
    const median = sorted[Math.floor(sorted.length / 2)];
    const big = withF.filter((a) => (a.followers ?? 0) >= Math.max(100, median * 5));
    const neglected = big.filter((a) => content(a) <= 4);
    if (neglected.length) {
      const share = Math.round((neglected.reduce((x, a) => x + (a.followers ?? 0), 0) / totals.followers) * 100);
      advice.push({ level: 'critical', title: `${share}% من جمهورك في حسابات شبه متوقفة`, detail: `هذه الحسابات فيها أكبر عدد متابعين لكن نُشر عليها ${neglected.map((a) => `${a.name}: ${content(a)}`).join('، ')} خلال الفترة. انشر عليها ريلز يوميًا أولًا — جمهورها موجود.`, accounts: neglected.map((a) => a.name) });
    }
    const tiny = withF.filter((a) => (a.followers ?? 0) < 50 && content(a) >= 12);
    if (tiny.length) advice.push({ level: 'high', title: 'نشر كثيف على حسابات بلا جمهور بعد', detail: `${tiny.map((a) => `${a.name} (${a.followers} متابع، ${content(a)} منشورًا)`).join('، ')}. خفّفها إلى 3–4 ريلز أسبوعيًا ووجّه الجهد للحسابات الكبيرة، مع ستوري ترويج متبادل منها.`, accounts: tiny.map((a) => a.name) });
    const dormant = withF.filter((a) => (a.followers ?? 0) >= 500 && content(a) >= 2 && ((a.posts.reach + a.reels.reach) / content(a)) / (a.followers ?? 1) < 0.02);
    if (dormant.length) advice.push({ level: 'high', title: 'متابعون كثيرون لكن الوصول أقل من 2%', detail: `${dormant.map((a) => `${a.name}: ~${Math.round((a.posts.reach + a.reels.reach) / content(a))} وصول لكل منشور من ${a.followers} متابع`).join('، ')}. الخوارزمية لا تعرض المحتوى لأن النشر متقطع — الاستمرارية اليومية بالريلز توقظ الحساب.`, accounts: dormant.map((a) => a.name) });
  }
  const reelWins = accounts.filter((a) => a.reels.count >= 2 && a.posts.count >= 2 && a.reels.avgReach >= a.posts.avgReach * 2);
  if (reelWins.length) advice.push({ level: 'high', title: 'الريلز تصل أضعاف الصور', detail: reelWins.map((a) => `${a.name}: ×${(a.reels.avgReach / Math.max(1, a.posts.avgReach)).toFixed(1)} (${a.reels.avgReach} مقابل ${a.posts.avgReach})`).join('، ') + '. اجعل هذه الحسابات «ريلز أولًا» (مزيج النمو).', accounts: reelWins.map((a) => a.name) });
  const noReels = accounts.filter((a) => a.reels.count === 0 && a.posts.count >= 3);
  if (noReels.length) advice.push({ level: 'medium', title: 'حسابات بلا ريلز', detail: `${noReels.map((a) => a.name).join('، ')} — نشرت صورًا فقط. جرّب ريلز أسبوعيًا على الأقل.`, accounts: noReels.map((a) => a.name) });
  const silent = accounts.filter((a) => !a.error && content(a) === 0);
  if (silent.length) advice.push({ level: 'medium', title: 'لم يُنشر شيء خلال الفترة', detail: silent.map((a) => `${a.name}${a.followers ? ` (${a.followers} متابع)` : ''}`).join('، ') + '. فعّل النشر الآلي لها أو أوقفها رسميًا.', accounts: silent.map((a) => a.name) });
  const stars = accounts.filter((a) => a.reels.count >= 2 && a.reels.avgReach >= Math.max(30, totals.reelAvg * 2));
  if (stars.length) advice.push({ level: 'good', title: 'ما ينجح — كرّره', detail: stars.map((a) => `${a.name}: متوسط ${a.reels.avgReach} وصول للريل`).join('، ') + '. «ضاعف الناجح» يحوّل أفضل منشوراتها إلى ريلز جديدة.', accounts: stars.map((a) => a.name) });
  return advice;
}

export async function saveInsights(s: InsightsSnapshot) {
  await prisma.systemSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: s as unknown as object }, update: { value: s as unknown as object } });
}
export async function loadInsights(): Promise<InsightsSnapshot | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: KEY } });
  return (row?.value as unknown as InsightsSnapshot) ?? null;
}
