import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { getSettings } from '../settings';
import { enq } from '../queue/queues';
import { audit, notify } from '../audit';
import type { Direction } from '../creative/options';

/**
 * «ضاعف الناجح»: posts that clearly beat their own account (reach ≥ N× the account median over 30 days,
 * or the top saves+shares per reach) get ONE fresh follow-up concept — same product and angle, new design,
 * as a Reel (Reels reach non-followers). It goes through the normal approval / autonomy rules, the
 * duplicate check and the 30-minute gap. Real metrics only; nothing is reposted or copied.
 */
export interface Winner { adId: string; accountId: string; account: string; productId: string; headline: string | null; format: string; reach: number; medianReach: number; multiple: number; sendsSaves: number; reason: string; publicUrl: string | null }

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };

export async function findWinners(minMultiple = 2, days = 30): Promise<Winner[]> {
  const rows = await prisma.publicationResult.findMany({
    where: { verifiedAt: { gte: new Date(Date.now() - days * 86400_000) }, metricsFetchedAt: { not: null }, job: { primary: true } },
    select: { metrics: true, publicUrl: true, job: { select: { accountId: true, account: { select: { name: true } }, advertisement: { select: { id: true, productId: true, headline: true, format: true, createdBy: true } } } } },
  });
  const byAcc = new Map<string, typeof rows>();
  for (const r of rows) if (r.job.advertisement.createdBy !== 'cross-promo') byAcc.set(r.job.accountId, [...(byAcc.get(r.job.accountId) ?? []), r]);
  const out: Winner[] = [];
  for (const [accountId, list] of byAcc) {
    const reachOf = (r: (typeof rows)[number]) => { const m = (r.metrics ?? {}) as { reach?: number | null; views?: number | null }; return m.reach ?? m.views ?? 0; };
    const ssOf = (r: (typeof rows)[number]) => { const m = (r.metrics ?? {}) as { saves?: number | null; shares?: number | null }; return (m.saves ?? 0) + (m.shares ?? 0); };
    const measured = list.filter((r) => reachOf(r) > 0);
    if (measured.length < 5) continue; // too little data to call anything a winner
    const med = median(measured.map(reachOf));
    const ssRate = measured.map((r) => ssOf(r) / reachOf(r));
    const topSs = Math.max(...ssRate);
    for (const r of measured) {
      const reach = reachOf(r), multiple = med ? reach / med : 0, ss = ssOf(r);
      const byReach = multiple >= minMultiple;
      const bySends = ss >= 3 && ss / reach === topSs && topSs > 2 * median(ssRate);
      if (!byReach && !bySends) continue;
      const ad = r.job.advertisement;
      out.push({ adId: ad.id, accountId, account: r.job.account.name, productId: ad.productId, headline: ad.headline, format: ad.format, reach, medianReach: Math.round(med), multiple: Math.round(multiple * 10) / 10, sendsSaves: ss, reason: byReach ? `وصول ${Math.round(multiple * 10) / 10}× متوسط الحساب` : 'أعلى حفظ ومشاركة', publicUrl: r.publicUrl });
    }
  }
  return out.sort((a, b) => b.multiple - a.multiple);
}

/** Weekly: queue one follow-up per new winner, up to the weekly cap. */
export async function boostWinners(opts: { force?: boolean; actor?: string } = {}) {
  const s = await getSettings();
  const cfg = s.growth.winners;
  if (!cfg.enabled && !opts.force) return { boosted: [], reason: 'disabled' };
  const week = new Date(Date.now() - 7 * 86400_000);
  const doneThisWeek = await prisma.auditLog.count({ where: { action: 'growth.winner_boost', createdAt: { gte: week } } });
  let room = Math.max(0, cfg.maxPerWeek - doneThisWeek);
  const boosted: string[] = [];
  for (const w of await findWinners(cfg.minMultiple)) {
    if (!room) break;
    if (await prisma.auditLog.count({ where: { action: 'growth.winner_boost', targetId: w.adId } })) continue; // each winner once
    const acc = await prisma.socialAccount.findUnique({ where: { id: w.accountId } });
    if (!acc || acc.paused) continue;
    const src = await prisma.advertisement.findUnique({ where: { id: w.adId }, select: { language: true, options: true } });
    const d = ((src?.options ?? {}) as { direction?: Direction | null }).direction ?? {};
    const direction: Direction = {
      ...(d.contentType ? { contentType: d.contentType } : {}), ...(d.segment ? { segment: d.segment } : {}), ...(d.market ? { market: d.market } : {}), ...(d.occasion ? { occasion: d.occasion } : {}),
      idea: `متابعة لفكرة نجحت مع جمهورنا (${w.reason}): «${(w.headline ?? '').slice(0, 80)}». قدّم نفس الفائدة بزاوية جديدة وتصميم مختلف — لا تكرر العنوان.`,
    };
    await enq.generate({ accountId: w.accountId, productId: w.productId, format: 'REEL_VIDEO', language: src?.language as 'ar' | 'en' | 'ml' | undefined, direction, createdBy: 'winners' }, `winner-${w.adId}`);
    await audit({ actorLabel: opts.actor ?? 'growth', action: 'growth.winner_boost', targetType: 'advertisement', targetId: w.adId, details: { account: w.account, reach: w.reach, median: w.medianReach, reason: w.reason } as Prisma.InputJsonValue });
    boosted.push(w.adId); room--;
  }
  if (boosted.length) await notify('INFO', 'WINNERS_BOOSTED', 'ضاعف الناجح', `أُنشئت ${boosted.length} ريلز جديدة من أفضل منشوراتك أداءً — تمر بالموافقة المعتادة.`);
  return { boosted, reason: boosted.length ? 'ok' : 'no_new_winners' };
}
