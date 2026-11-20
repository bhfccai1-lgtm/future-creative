import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { isQuestion, metricFields, postScore, type PlanPost } from './account-plan';
import { CONCEPTS, DESIGN_TYPES } from '../creative/options';

/**
 * «🧠 دماغ الحساب» — a learning loop per account, from the REAL numbers only.
 *  LEARN (nightly): the measured posts of the last 60 days are compared along several dimensions (opening type,
 *    format, hour, occasion vs everyday, product category, caption length). A rule is kept only when both sides have
 *    at least MIN_N posts and the winner is ≥ 30 % better on retained views (views × retention + sends/saves) —
 *    every rule carries its sample sizes, so the owner sees how sure it is.
 *  APPLY: every new design of that account gets the rules in its brief (they steer the copy and the idea).
 *  It also learns whether «🔥 رادار الترند» posts beat regular ones on this account.
 *  🎨 VISUAL MEMORY: it also learns which visual concept, lighting and composition win on this account; while
 *    applying, the next image leans toward the winners (no extra AI call, no extra cost).
 *  EXPLORE: 1 design in 5 is deliberately made WITHOUT the rules (marked «تجربة»), so the brain keeps learning
 *    instead of freezing on an old pattern (epsilon-greedy, ε = 0.2).
 */
export const MIN_N = 3, MIN_LIFT = 0.3, EXPLORE = 0.2;
export interface BrainRule { visual?: keyof VisualArt; dim: string; best: string; worst: string; bestScore: number; worstScore: number; lift: number; nBest: number; nWorst: number; ar: string; prompt: string }
export interface AccountBrain { accountId: string; at: string; posts: number; rules: BrainRule[] }

export type VisualArt = { concept?: string; lighting?: string; composition?: string };
type Row = { p: PlanPost; hour: number; occasion: boolean; captionLen: number; category: string; trend?: boolean; art?: VisualArt };
const bhHour = (d: Date) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bahrain', hour: '2-digit', hour12: false }).format(d)) % 24;
const LIGHT_AR: Record<string, string> = { softbox: 'إضاءة الاستوديو الناعمة', golden_hour: 'ضوء الغروب الذهبي', daylight: 'ضوء النهار الطبيعي', rim: 'الإضاءة الحافّة الدرامية', spotlight: 'بقعة الضوء المسرحية', ambient_evening: 'أجواء المساء الدافئة' };
const artAr = (list: readonly { value: string; ar: string }[], v: string) => list.find((x) => x.value === v)?.ar ?? v;
const FORMAT_AR: Record<string, string> = { REEL_VIDEO: 'الريلز', IMAGE_CAROUSEL: 'الكاروسيل', IMAGE_FEED: 'المنشور العمودي', IMAGE_SQUARE: 'المربع', IMAGE_STORY: 'الستوري' };

/** the dimensions the brain compares: label for the owner + the instruction for the brief writer */
const DIMS: { id: string; visual?: keyof VisualArt; of: (r: Row) => string | null; ar: (v: string) => string; prompt: (best: string, worst: string) => string }[] = [
  { id: 'hook', of: (r) => (r.p.hook ? (isQuestion(r.p.hook) ? 'question' : 'statement') : null), ar: (v) => (v === 'question' ? 'الافتتاحية بسؤال' : 'الافتتاحية بجملة أو بالمنتج'),
    prompt: (b) => (b === 'statement' ? 'Open with a bold statement or the product itself — NOT with a question (questions performed clearly worse here).' : 'Open with a short, relatable question (questions performed clearly better here).') },
  { id: 'format', of: (r) => r.p.format, ar: (v) => FORMAT_AR[v] ?? v, prompt: (b, w) => `${FORMAT_AR[b] ? b : b} performed better than ${w} on this account — make the most of this format's strengths.` },
  { id: 'daypart', of: (r) => (r.hour < 12 ? 'morning' : r.hour < 17 ? 'afternoon' : 'evening'), ar: (v) => ({ morning: 'النشر صباحًا', afternoon: 'النشر عصرًا', evening: 'النشر مساءً' }[v] ?? v), prompt: () => '' },
  { id: 'occasion', of: (r) => (r.occasion ? 'occasion' : 'everyday'), ar: (v) => (v === 'occasion' ? 'منشورات المناسبات' : 'المنشورات اليومية (بدون مناسبة)'),
    prompt: (b) => (b === 'everyday' ? 'Prefer an everyday, evergreen angle over occasion greetings (they did better here).' : 'Tie the idea to a real occasion when one fits (occasion posts did better here).') },
  { id: 'caption', of: (r) => (r.captionLen <= 220 ? 'short' : 'long'), ar: (v) => (v === 'short' ? 'النص القصير' : 'النص الطويل'),
    prompt: (b) => (b === 'short' ? 'Keep the caption short: 3–4 short lines before the call to action.' : 'A fuller caption (5–6 lines) worked better here — explain the benefit clearly.') },
  { id: 'trend', of: (r) => (r.trend === undefined ? null : r.trend ? 'trend' : 'regular'), ar: (v) => (v === 'trend' ? 'منشورات الترند' : 'المنشورات العادية'),
    prompt: (b) => (b === 'trend' ? 'Trend-based posts did clearly better here — when the idea rides a current trend, make the trend obvious in the first second.' : '') },
  // 🎨 visual memory: steers pickArt, not the copy (prompt '')
  { id: 'concept', visual: 'concept', of: (r) => r.art?.concept ?? null, ar: (v) => `الفكرة البصرية «${artAr(CONCEPTS, v)}»`, prompt: () => '' },
  { id: 'lighting', visual: 'lighting', of: (r) => r.art?.lighting ?? null, ar: (v) => LIGHT_AR[v] ?? v, prompt: () => '' },
  { id: 'composition', visual: 'composition', of: (r) => r.art?.composition ?? null, ar: (v) => `التكوين «${artAr(DESIGN_TYPES, v)}»`, prompt: () => '' },
  { id: 'category', of: (r) => r.category || null, ar: (v) => `منتجات «${v}»`, prompt: () => '' },
];

/** pure: rules from measured rows (exported for tests) */
export function learnRules(rows: Row[]): BrainRule[] {
  const rules: BrainRule[] = [];
  for (const d of DIMS) {
    const groups = new Map<string, number[]>();
    for (const r of rows) { const v = d.of(r); if (v) groups.set(v, [...(groups.get(v) ?? []), postScore(r.p)]); }
    const stats = [...groups.entries()].filter(([, xs]) => xs.length >= MIN_N).map(([v, xs]) => ({ v, n: xs.length, mean: xs.reduce((a, b) => a + b, 0) / xs.length }));
    if (stats.length < 2) continue;
    stats.sort((a, b) => b.mean - a.mean);
    const best = stats[0], worst = stats[stats.length - 1];
    if (worst.mean <= 0 ? best.mean <= 0 : best.mean / worst.mean - 1 < MIN_LIFT) continue;
    const lift = worst.mean > 0 ? Math.round((best.mean / worst.mean - 1) * 100) / 100 : 9.99;
    rules.push({ ...(d.visual ? { visual: d.visual } : {}), dim: d.id, best: best.v, worst: worst.v, bestScore: Math.round(best.mean * 10) / 10, worstScore: Math.round(worst.mean * 10) / 10, lift, nBest: best.n, nWorst: worst.n,
      ar: `${d.ar(best.v)} أفضل من ${d.ar(worst.v)} بـ ${Math.round(lift * 100)}٪ (عينة ${best.n} مقابل ${worst.n})`, prompt: d.prompt(best.v, worst.v) });
  }
  return rules.sort((a, b) => b.lift - a.lift);
}

/** LEARN: recompute every account's brain from the last 60 days (nightly) */
export async function learnBrains(now = new Date()) {
  const since = new Date(now.getTime() - 60 * 86400_000);
  const jobs = await prisma.publicationJob.findMany({
    where: { primary: true, result: { verifiedAt: { gte: since }, metricsFetchedAt: { not: null } } },
    include: { result: true, advertisement: { select: { caption: true, headline: true, format: true, options: true, product: { select: { category: { select: { nameAr: true } } } } } } },
  });
  const fromTrend = new Set((await prisma.idea.findMany({ where: { source: 'trend', usedAdId: { in: jobs.map((j) => j.advertisementId) } }, select: { usedAdId: true } })).map((i) => i.usedAdId));
  const byAcc = new Map<string, Row[]>();
  for (const j of jobs) {
    const cap = j.advertisement.caption ?? '';
    const p: PlanPost = { adId: j.advertisementId, hook: cap.split('\n').map((l) => l.trim()).find(Boolean) ?? '', headline: j.advertisement.headline, format: j.advertisement.format, publishedAt: '', product: '', category: '',
      ...metricFields(j.result?.metrics, { roundRates: false }) };
    const dir = ((j.advertisement.options ?? {}) as { direction?: { occasion?: string | null; art?: VisualArt | null } }).direction;
    const occ = dir?.occasion;
    byAcc.set(j.accountId, [...(byAcc.get(j.accountId) ?? []), { p, hour: bhHour(j.result?.verifiedAt ?? j.scheduledFor), occasion: !!occ && occ !== 'everyday', captionLen: cap.split('\n\n#')[0].length, category: j.advertisement.product.category.nameAr, trend: fromTrend.has(j.advertisementId), art: dir?.art ?? undefined }]);
  }
  const out: AccountBrain[] = [];
  for (const [accountId, rows] of byAcc) {
    const brain: AccountBrain = { accountId, at: now.toISOString(), posts: rows.length, rules: learnRules(rows) };
    await prisma.systemSetting.upsert({ where: { key: `brain:${accountId}` }, create: { key: `brain:${accountId}`, value: brain as unknown as Prisma.InputJsonValue, updatedBy: "brain" }, update: { value: brain as unknown as Prisma.InputJsonValue, updatedBy: "brain" } });
    out.push(brain);
  }
  return { accounts: out.length, rules: out.reduce((a, b) => a + b.rules.length, 0) };
}

export async function brainOf(accountId: string): Promise<AccountBrain | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: `brain:${accountId}` } }).catch(() => null);
  return (row?.value as AccountBrain | undefined) ?? null;
}

/** APPLY / EXPLORE: the brief instruction for the next design (null = nothing learnt yet, or this one explores) */
export async function brainGuidance(accountId: string, rng: () => number = Math.random): Promise<{ text: string | null; mode: 'apply' | 'explore' | 'none'; rules: string[]; art: VisualArt }> {
  const b = await brainOf(accountId);
  const usable = (b?.rules ?? []).filter((r) => r.prompt);
  const visual = (b?.rules ?? []).filter((r) => r.visual);
  if (!usable.length && !visual.length) return { text: null, mode: 'none', rules: [], art: {} };
  if (rng() < EXPLORE) return { text: null, mode: 'explore', rules: [], art: {} };
  const art: VisualArt = Object.fromEntries(visual.map((r) => [r.visual!, r.best]));
  return {
    text: usable.length ? `PERFORMANCE MEMORY of this account (learnt from its real Instagram numbers — follow it): ${usable.slice(0, 4).map((r) => r.prompt).join(' ')}` : null,
    mode: 'apply', rules: [...usable.slice(0, 4), ...visual].map((r) => r.dim), art,
  };
}
