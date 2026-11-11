import { prisma } from '../db';
import { redis } from '../queue/connection';
import { getSettings } from '../settings';
import { startOfDayInTz, fmtLocal } from '../time';
import { emitEvent } from './events';

/** End-of-day summary (Bahrain day): what was made, approved, scheduled, verified, failed and spent. */
export async function buildDailyDigest(now = new Date()) {
  const from = startOfDayInTz(now);
  const [created, pending, scheduledToday, published, failed, unknown, spend, upcoming] = await Promise.all([
    prisma.advertisement.count({ where: { createdAt: { gte: from } } }),
    prisma.approvalRequest.count({ where: { status: 'PENDING' } }),
    prisma.publicationJob.count({ where: { state: 'SCHEDULED', updatedAt: { gte: from } } }),
    prisma.publicationResult.count({ where: { verifiedAt: { gte: from } } }),
    prisma.publicationJob.count({ where: { state: 'FAILED', updatedAt: { gte: from } } }),
    prisma.publicationJob.count({ where: { state: 'UNKNOWN' } }),
    prisma.aiUsage.aggregate({ _sum: { costUsd: true }, where: { createdAt: { gte: from } } }),
    prisma.publicationJob.findMany({ where: { state: { in: ['QUEUED', 'SCHEDULED'] }, scheduledFor: { gte: now } }, orderBy: { scheduledFor: 'asc' }, take: 5, include: { account: { select: { name: true } }, advertisement: { select: { headline: true, format: true } } } }),
  ]);
  return {
    date: fmtLocal(now, undefined, 'yyyy-MM-dd'), created, pendingApprovals: pending, scheduledToday, publishedVerified: published, failed, unknown,
    aiSpendUsd: Number(Number(spend._sum.costUsd ?? 0).toFixed(2)),
    upcoming: upcoming.map((j) => ({ at: fmtLocal(j.scheduledFor), account: j.account.name, headline: j.advertisement.headline, format: j.advertisement.format })),
  };
}

export async function emitDailyDigest(now = new Date()) {
  const d = await buildDailyDigest(now);
  await emitEvent('daily.digest', { ...d, approvalsUrl: '/approvals', postsUrl: '/posts' });
  return d;
}

/** Hourly: one reminder per design that has waited longer than the configured hours (never repeated). */
export async function runApprovalReminders(now = new Date()) {
  const s = await getSettings();
  if (!s.n8n.enabled || !s.n8n.approvalReminderHours) return { reminded: 0 };
  const cutoff = new Date(now.getTime() - s.n8n.approvalReminderHours * 3600_000);
  const waiting = await prisma.approvalRequest.findMany({ where: { status: 'PENDING', createdAt: { lt: cutoff } }, include: { advertisement: { select: { id: true, headline: true, account: { select: { name: true } } } } }, take: 50, orderBy: { createdAt: 'asc' } });
  const fresh: typeof waiting = [];
  for (const w of waiting) if (await redis().set(`fc:n8n:reminded:${w.id}`, '1', 'EX', 14 * 86400, 'NX')) fresh.push(w);
  if (fresh.length) await emitEvent('approvals.reminder', { hours: s.n8n.approvalReminderHours, totalPending: waiting.length, items: fresh.slice(0, 10).map((w) => ({ adId: w.advertisement.id, account: w.advertisement.account.name, headline: w.advertisement.headline, waitingSince: fmtLocal(w.createdAt), reviewUrl: `/ads/${w.advertisement.id}` })) });
  return { reminded: fresh.length };
}
