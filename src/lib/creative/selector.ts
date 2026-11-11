import type { Product, SocialAccount } from '@prisma/client';
import { prisma } from '../db';

export type Rng = () => number;

/**
 * Picks ONE product for an account:
 *  - restricted to active products allowed for the account (empty list = all active)
 *  - rotation: excludes products used in the account's most recent ads
 *  - exploitation: weights by verified performance score; exploration: ε-uniform choice
 */
export function chooseProduct(candidates: Product[], recentProductIds: string[], rng: Rng = Math.random, epsilon = 0.2): Product | null {
  if (!candidates.length) return null;
  // large catalogues: don't repeat any of the last 10 products used on the account (or n-1 for small ones)
  const rotateN = Math.min(10, candidates.length - 1);
  const blocked = new Set(recentProductIds.slice(0, rotateN));
  const pool = candidates.filter((p) => !blocked.has(p.id));
  const list = pool.length ? pool : candidates;
  if (rng() < epsilon) return list[Math.floor(rng() * list.length)];
  const weights = list.map((p) => 1 + Math.max(0, p.performanceScore));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < list.length; i++) { r -= weights[i]; if (r <= 0) return list[i]; }
  return list[list.length - 1];
}

export async function selectProductForAccount(account: SocialAccount, rng: Rng = Math.random) {
  const candidates = await prisma.product.findMany({ where: { active: true, ...allowedWhere(account) } });
  const recent = await prisma.advertisement.findMany({
    where: { accountId: account.id, state: { notIn: ['REJECTED', 'FAILED'] } }, orderBy: { createdAt: 'desc' }, take: 30, select: { productId: true },
  });
  return chooseProduct(candidates, recent.map((r) => r.productId), rng);
}

/** No restriction = all active products; otherwise the listed products OR any product in the listed categories. */
export function allowedWhere(account: Pick<SocialAccount, 'allowedProductIds' | 'allowedCategoryIds'>) {
  const ids = account.allowedProductIds, cats = account.allowedCategoryIds ?? [];
  if (!ids.length && !cats.length) return {};
  return { OR: [...(ids.length ? [{ id: { in: ids } }] : []), ...(cats.length ? [{ categoryId: { in: cats } }] : [])] };
}
export const productAllowed = (account: Pick<SocialAccount, 'allowedProductIds' | 'allowedCategoryIds'>, product: { id: string; categoryId: string }) => {
  const ids = account.allowedProductIds, cats = account.allowedCategoryIds ?? [];
  return (!ids.length && !cats.length) || ids.includes(product.id) || cats.includes(product.categoryId);
};

/** Recompute product performance from VERIFIED published results that carry an engagement score. */
export async function refreshPerformanceScores() {
  const rows = await prisma.publicationResult.findMany({
    where: { verifiedAt: { not: null }, engagementScore: { not: null } },
    select: { engagementScore: true, job: { select: { advertisement: { select: { productId: true } } } } },
  });
  const agg = new Map<string, { s: number; n: number }>();
  for (const r of rows) {
    const pid = r.job.advertisement.productId;
    const a = agg.get(pid) ?? { s: 0, n: 0 }; a.s += r.engagementScore!; a.n++; agg.set(pid, a);
  }
  const all = [...agg.values()].map((a) => a.s / a.n);
  const mean = all.length ? all.reduce((x, y) => x + y, 0) / all.length : 0;
  for (const [pid, a] of agg) {
    const score = mean > 0 ? (a.s / a.n) / mean - 1 : 0; // relative to average, 0 = average
    await prisma.product.update({ where: { id: pid }, data: { performanceScore: Math.max(-1, Math.min(4, score)) } });
  }
  return agg.size;
}
