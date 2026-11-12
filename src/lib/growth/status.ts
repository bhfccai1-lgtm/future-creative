import { prisma } from '../db';
import { getSettings } from '../settings';
import { peakHoursFor } from './peak-hours';
import { findWinners } from './winners';

/** Dashboard data: settings, learned peak hours per account, current winners. */
export async function growthStatus() {
  const s = await getSettings();
  const accounts = await prisma.socialAccount.findMany({ where: { paused: false }, select: { id: true, name: true, timezone: true }, orderBy: { name: 'asc' } });
  const peaks = await Promise.all(accounts.map(async (a) => ({ id: a.id, name: a.name, ...(await peakHoursFor(a, s.growth.peakHours.count)) })));
  const winners = (await findWinners(s.growth.winners.minMultiple)).slice(0, 12);
  const boosted = new Set((await prisma.auditLog.findMany({ where: { action: 'growth.winner_boost', targetId: { in: winners.map((w) => w.adId) } }, select: { targetId: true } })).map((x) => x.targetId));
  return { growth: s.growth, peaks: peaks.map((p) => ({ id: p.id, name: p.name, hours: p.hours, source: p.source, sample: p.sample })), winners: winners.map((w) => ({ ...w, boosted: boosted.has(w.adId) })) };
}
