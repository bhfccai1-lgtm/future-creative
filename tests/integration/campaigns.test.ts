import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { runCampaignCycle } from '@/lib/campaigns/cycle';
import { nextSlot } from '@/lib/campaigns/slots';
import { generateAdvertisement } from '@/lib/pipeline/generate';
import { approveAdvertisement } from '@/lib/publishing/jobs';
import { setAiProviderOverride } from '@/lib/ai';
import { setPublishingAdapterOverride } from '@/lib/publishing/registry';
import { updateSettings } from '@/lib/settings';
import { captured, captureQueues, FakeAdapter, FakeAiProvider, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });

async function mkCampaign(accountIds: string[], over: Record<string, unknown> = {}) {
  const startAt = new Date(Date.now() + 60 * 60_000);
  const data = { name: 'Test', accountIds, scheduleType: 'RECURRING', everyHours: 6, daysOfWeek: [] as number[], timeMode: 'FIXED', startAt, createdBy: 't', direction: { occasion: 'eid_fitr' }, ...over };
  const first = nextSlot({ scheduleType: data.scheduleType as 'ONCE' | 'RECURRING', everyHours: data.everyHours as number, daysOfWeek: data.daysOfWeek, timeMode: data.timeMode as 'FIXED', startAt: data.startAt as Date, runs: 0 }, new Date());
  return prisma.campaign.create({ data: { ...(data as never), nextRunAt: first } });
}

describe('recurring campaigns', () => {
  it('plans one NEW generation per account for the next slot, with the campaign direction; idempotent', async () => {
    const { accounts } = await seedBase({ accounts: 2 });
    const c = await mkCampaign(accounts.map((a) => a.id));
    const r = await runCampaignCycle();
    expect(r.planned).toBe(2);
    expect(captured.generate).toHaveLength(2);
    expect(captured.generate[0].data).toMatchObject({ createdBy: `campaign:${c.id}`, direction: { occasion: 'eid_fitr' } });
    const after = await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.runs).toBe(1);
    expect(after.nextRunAt!.getTime() - c.nextRunAt!.getTime()).toBe(6 * 3600_000);
    // running again before the next slot is due plans nothing
    expect((await runCampaignCycle()).planned).toBe(0);
    expect(await prisma.publicationSchedule.count({ where: { campaignId: c.id } })).toBe(2);
  });

  it('ONCE campaign runs exactly once then deactivates; kill switch blocks', async () => {
    const { accounts } = await seedBase({ accounts: 1 });
    const c = await mkCampaign([accounts[0].id], { scheduleType: 'ONCE' });
    await updateSettings((s) => ({ ...s, killSwitch: true }));
    expect((await runCampaignCycle()).skipped).toBe('KILL_SWITCH');
    await updateSettings((s) => ({ ...s, killSwitch: false }));
    expect((await runCampaignCycle()).planned).toBe(1);
    const after = await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.active).toBe(false);
    expect(after.nextRunAt).toBeNull();
  });

  it('missed slots (worker down) are skipped, not published late in a burst', async () => {
    const { accounts } = await seedBase({ accounts: 1 });
    const c = await mkCampaign([accounts[0].id], { startAt: new Date(Date.now() - 20 * 3600_000), everyHours: 6 });
    await prisma.campaign.update({ where: { id: c.id }, data: { nextRunAt: new Date(Date.now() - 20 * 3600_000) } });
    await runCampaignCycle();
    const schedules = await prisma.publicationSchedule.findMany({ where: { campaignId: c.id } });
    expect(schedules.length).toBeLessThanOrEqual(1);
    for (const s of schedules) expect(s.slotAt.getTime()).toBeGreaterThan(Date.now() - 15 * 60_000);
  });

  it('approving a campaign design schedules it at the campaign slot (even with global auto-publish off)', async () => {
    const { accounts, admin } = await seedBase({ accounts: 1, settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false } }) });
    setAiProviderOverride(new FakeAiProvider()); setPublishingAdapterOverride(new FakeAdapter());
    const c = await mkCampaign([accounts[0].id], { startAt: new Date(Date.now() + 90 * 60_000) });
    await runCampaignCycle();
    const job = captured.generate[0].data as { accountId: string; scheduleId: string; createdBy: string; direction: never };
    const r = await generateAdvertisement({ ...job });
    expect(r.advertisement.state).toBe('QUALITY_REVIEW');
    const pub = await approveAdvertisement(r.advertisement.id, { id: admin.id, email: admin.email });
    expect(pub).not.toBeNull();
    const sched = await prisma.publicationSchedule.findUniqueOrThrow({ where: { id: job.scheduleId } });
    expect(pub!.scheduledFor.getTime()).toBe(sched.slotAt.getTime());
    expect(sched.campaignId).toBe(c.id);
  });
});
