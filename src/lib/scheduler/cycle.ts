import type { SocialAccount } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { getSettings } from '../settings';
import { audit } from '../audit';
import { enq } from '../queue/queues';
import { floorToHour, inWindow, startOfDayInTz } from '../time';

export interface CycleSummary { at: string; slotAt: string; skipped?: string; mode?: string; planned: string[]; ineligible: Record<string, string> }

/**
 * Hourly scheduler cycle (wakes every 60 minutes, Asia/Bahrain).
 * Plans content for the NEXT hour slot so generation finishes well before the publish time.
 * Each account keeps its own interval; Mode B caps total posts per hour across selected accounts.
 * Idempotent: the (accountId, slotAt) unique constraint means a repeated/concurrent cycle plans nothing twice.
 */
export async function runSchedulerCycle(now = new Date()): Promise<CycleSummary> {
  const s = await getSettings();
  const slotAt = new Date(floorToHour(now).getTime() + 3600_000);
  const base: CycleSummary = { at: now.toISOString(), slotAt: slotAt.toISOString(), planned: [], ineligible: {} };
  if (s.killSwitch) return { ...base, skipped: 'KILL_SWITCH' };
  if (!s.autoPublishGlobal) return { ...base, skipped: 'AUTOPUBLISH_OFF' };

  let accounts = await prisma.socialAccount.findMany({ where: { autoPublishEnabled: true, paused: false }, include: { connection: true }, orderBy: [{ lastPublishedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }] });
  if (s.schedulerMode === 'B_FIXED_PER_HOUR') accounts = accounts.filter((a) => s.modeBAccountIds.includes(a.id));

  const eligible: SocialAccount[] = [];
  const dayStart = startOfDayInTz(now);
  for (const a of accounts) {
    const c = a.connection;
    if (!c || c.status !== 'CONNECTED' || !c.canPublish) { base.ineligible[a.id] = 'NOT_CONNECTED'; continue; }
    if (!inWindow(slotAt, a.publishWindowStart, a.publishWindowEnd, a.timezone)) { base.ineligible[a.id] = 'OUTSIDE_WINDOW'; continue; }
    if (s.schedulerMode === 'A_PER_ACCOUNT_HOURLY' && a.nextPublishAt && a.nextPublishAt.getTime() > slotAt.getTime()) { base.ineligible[a.id] = 'NOT_DUE'; continue; }
    const pendingFuture = await prisma.publicationJob.count({ where: { accountId: a.id, state: { in: ['QUEUED', 'PUBLISHING', 'SCHEDULED', 'UNKNOWN'] }, scheduledFor: { gte: new Date(slotAt.getTime() - (a.publishIntervalMinutes * 60_000) / 2) } } });
    if (pendingFuture > 0) { base.ineligible[a.id] = 'ALREADY_HAS_SCHEDULED'; continue; }
    const today = await prisma.advertisement.count({ where: { accountId: a.id, createdAt: { gte: dayStart } } });
    if (today >= a.maxDailyAds) { base.ineligible[a.id] = 'DAILY_LIMIT'; continue; }
    eligible.push(a);
  }

  const chosen = s.schedulerMode === 'B_FIXED_PER_HOUR' ? eligible.slice(0, s.modeBPostsPerHour) : eligible;
  for (const a of chosen) {
    let schedule;
    try {
      schedule = await prisma.publicationSchedule.create({ data: { accountId: a.id, slotAt, status: 'GENERATING' } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') { base.ineligible[a.id] = 'SLOT_ALREADY_PLANNED'; continue; }
      throw e;
    }
    await prisma.socialAccount.update({ where: { id: a.id }, data: { nextPublishAt: new Date(slotAt.getTime() + a.publishIntervalMinutes * 60_000) } });
    await enq.generate({ accountId: a.id, scheduleId: schedule.id, createdBy: 'scheduler' }, `gen-${schedule.id}`);
    base.planned.push(a.id);
  }
  await audit({ actorLabel: 'scheduler', action: 'scheduler.cycle', details: { slotAt: slotAt.toISOString(), mode: s.schedulerMode, planned: base.planned.length, ineligible: base.ineligible } });
  return { ...base, mode: s.schedulerMode };
}
