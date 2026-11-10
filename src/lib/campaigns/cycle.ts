import { Prisma, type Campaign } from '@prisma/client';
import { prisma } from '../db';
import { getSettings } from '../settings';
import { audit, notify } from '../audit';
import { enq } from '../queue/queues';
import { nextSlot, type SlotRule } from './slots';
import type { Direction } from '../creative/options';

export const ruleOf = (c: Pick<Campaign, 'scheduleType' | 'everyHours' | 'daysOfWeek' | 'timeMode' | 'startAt' | 'endAt' | 'maxRuns' | 'runs'>): SlotRule => ({
  scheduleType: c.scheduleType === 'ONCE' ? 'ONCE' : 'RECURRING', everyHours: c.everyHours, daysOfWeek: c.daysOfWeek,
  timeMode: c.timeMode === 'FIXED' ? 'FIXED' : 'BEST', startAt: c.startAt, endAt: c.endAt, maxRuns: c.maxRuns, runs: c.runs,
});

/** How far ahead designs are generated before their publication slot. */
export const GENERATE_AHEAD_MS = 2 * 3600_000;
/** Slots older than this when the worker gets to them are skipped (never published late in a burst). */
export const MISSED_GRACE_MS = 15 * 60_000;

/**
 * Campaign sweep (runs every 15 min). For each due slot it plans ONE new design per selected account:
 * a PublicationSchedule (unique per account+slot ⇒ idempotent) + a generation job carrying the
 * campaign's creative direction. Approval/publishing then follows the normal mode rules.
 */
export async function runCampaignCycle(now = new Date()) {
  const s = await getSettings();
  if (s.killSwitch) return { skipped: 'KILL_SWITCH', planned: 0 };
  const due = await prisma.campaign.findMany({ where: { active: true, nextRunAt: { not: null, lte: new Date(now.getTime() + GENERATE_AHEAD_MS) } } });
  let planned = 0;
  for (const c of due) {
    let slot: Date | null = c.nextRunAt!;
    let runs = c.runs;
    // skip slots that were missed (e.g. worker was down)
    while (slot && slot.getTime() < now.getTime() - MISSED_GRACE_MS) {
      slot = nextSlot({ ...ruleOf(c), runs }, slot);
    }
    if (!slot) { await prisma.campaign.update({ where: { id: c.id }, data: { active: false, nextRunAt: null } }); continue; }
    if (slot.getTime() > now.getTime() + GENERATE_AHEAD_MS) { await prisma.campaign.update({ where: { id: c.id }, data: { nextRunAt: slot } }); continue; }

    for (const accountId of c.accountIds) {
      let schedule;
      try {
        schedule = await prisma.publicationSchedule.create({ data: { accountId, slotAt: slot, status: 'GENERATING', campaignId: c.id } });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2002' || e.code === 'P2003')) continue; // already planned / account removed
        throw e;
      }
      await enq.generate({
        accountId, scheduleId: schedule.id, productId: c.productId ?? undefined, format: c.format ?? undefined,
        language: c.language ?? undefined, direction: (c.direction ?? undefined) as Direction | undefined, createdBy: `campaign:${c.id}`,
      }, `gen-${schedule.id}`);
      planned++;
    }
    runs += 1;
    const next = nextSlot({ ...ruleOf(c), runs }, slot);
    await prisma.campaign.update({ where: { id: c.id }, data: { runs, lastRunAt: slot, nextRunAt: next, active: next !== null } });
    if (!next) await notify('INFO', 'CAMPAIGN_DONE', 'اكتملت حملة', `الحملة «${c.name}» أنهت كل مواعيدها.`);
  }
  if (planned) await audit({ actorLabel: 'scheduler', action: 'campaign.cycle', details: { planned, campaigns: due.length } });
  return { planned, campaigns: due.length };
}

