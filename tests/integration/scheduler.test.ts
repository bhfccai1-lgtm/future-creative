import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { runSchedulerCycle } from '@/lib/scheduler/cycle';
import { updateSettings } from '@/lib/settings';
import { captured, captureQueues, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });

const NOW = new Date('2026-11-09T07:10:00Z'); // 10:10 Bahrain → plans the 11:00 slot

describe('hourly scheduler', () => {
  it('does nothing until auto-publishing is explicitly started', async () => {
    const { accounts } = await seedBase();
    await prisma.socialAccount.updateMany({ data: { autoPublishEnabled: true } });
    const r = await runSchedulerCycle(NOW);
    expect(r.skipped).toBe('AUTOPUBLISH_OFF');
    expect(captured.generate).toHaveLength(0);
    expect(accounts.length).toBe(2);
  });

  it('Mode A: plans one slot per eligible account for the next hour, idempotently', async () => {
    const { accounts } = await seedBase({ accounts: 3 });
    await prisma.socialAccount.updateMany({ where: { id: { in: [accounts[0].id, accounts[1].id] } }, data: { autoPublishEnabled: true } });
    await updateSettings((s) => ({ ...s, autoPublishGlobal: true }));
    const r = await runSchedulerCycle(NOW);
    expect(r.slotAt).toBe('2026-11-09T08:00:00.000Z');
    expect(r.planned.sort()).toEqual([accounts[0].id, accounts[1].id].sort());
    expect(captured.generate).toHaveLength(2);
    // second (or concurrent) run in the same hour plans nothing new
    const again = await runSchedulerCycle(new Date(NOW.getTime() + 60_000));
    expect(again.planned).toEqual([]);
    expect(await prisma.publicationSchedule.count()).toBe(2);
    const acc = await prisma.socialAccount.findUniqueOrThrow({ where: { id: accounts[0].id } });
    expect(acc.nextPublishAt?.toISOString()).toBe('2026-11-09T09:00:00.000Z');
  });

  it('respects each account\'s own interval and publishing window', async () => {
    const { accounts } = await seedBase({ accounts: 2 });
    await updateSettings((s) => ({ ...s, autoPublishGlobal: true }));
    await prisma.socialAccount.update({ where: { id: accounts[0].id }, data: { autoPublishEnabled: true, publishIntervalMinutes: 180 } });
    await prisma.socialAccount.update({ where: { id: accounts[1].id }, data: { autoPublishEnabled: true, publishWindowStart: '18:00', publishWindowEnd: '22:00' } });
    const r1 = await runSchedulerCycle(NOW);
    expect(r1.planned).toEqual([accounts[0].id]);
    expect(r1.ineligible[accounts[1].id]).toBe('OUTSIDE_WINDOW');
    const r2 = await runSchedulerCycle(new Date(NOW.getTime() + 3600_000)); // next hour: account 0 not due (3h interval)
    expect(r2.ineligible[accounts[0].id]).toBe('NOT_DUE');
    const r3 = await runSchedulerCycle(new Date(NOW.getTime() + 3 * 3600_000));
    expect(r3.planned).toContain(accounts[0].id);
  });

  it('Mode B: caps the number of posts per hour across selected accounts', async () => {
    const { accounts } = await seedBase({ accounts: 5 });
    await prisma.socialAccount.updateMany({ data: { autoPublishEnabled: true } });
    await updateSettings((s) => ({ ...s, autoPublishGlobal: true, schedulerMode: 'B_FIXED_PER_HOUR', modeBPostsPerHour: 2, modeBAccountIds: accounts.slice(0, 4).map((a) => a.id) }));
    const r = await runSchedulerCycle(NOW);
    expect(r.planned).toHaveLength(2);
    expect(r.planned.every((id) => accounts.slice(0, 4).some((a) => a.id === id))).toBe(true);
  });

  it('skips disconnected accounts, accounts with pending scheduled posts, and everything under the kill switch', async () => {
    const { accounts } = await seedBase({ accounts: 3 });
    await prisma.socialAccount.updateMany({ data: { autoPublishEnabled: true } });
    await updateSettings((s) => ({ ...s, autoPublishGlobal: true }));
    await prisma.socialConnection.update({ where: { accountId: accounts[0].id }, data: { status: 'EXPIRED', canPublish: false } });
    const ad = await prisma.advertisement.create({ data: { accountId: accounts[1].id, productId: (await prisma.product.findFirstOrThrow()).id, format: 'IMAGE_STORY', language: 'ar', state: 'SCHEDULED' } });
    await prisma.publicationJob.create({ data: { idempotencyKey: 'x', advertisementId: ad.id, accountId: accounts[1].id, provider: 'metricool', state: 'SCHEDULED', scheduledFor: new Date('2026-11-09T08:00:00Z') } });
    const r = await runSchedulerCycle(NOW);
    expect(r.ineligible[accounts[0].id]).toBe('NOT_CONNECTED');
    expect(r.ineligible[accounts[1].id]).toBe('ALREADY_HAS_SCHEDULED');
    expect(r.planned).toEqual([accounts[2].id]);
    await updateSettings((s) => ({ ...s, killSwitch: true }));
    expect((await runSchedulerCycle(new Date(NOW.getTime() + 3600_000))).skipped).toBe('KILL_SWITCH');
  });
});

describe('multi-account isolation', () => {
  it('disconnecting one account cancels only its queued jobs and leaves others untouched', async () => {
    const { accounts } = await seedBase({ accounts: 2 });
    const p = await prisma.product.findFirstOrThrow();
    for (const a of accounts) {
      const ad = await prisma.advertisement.create({ data: { accountId: a.id, productId: p.id, format: 'IMAGE_STORY', language: 'ar', state: 'QUEUED' } });
      await prisma.publicationJob.create({ data: { idempotencyKey: `k-${a.id}`, advertisementId: ad.id, accountId: a.id, provider: 'metricool', state: 'QUEUED', scheduledFor: new Date(Date.now() + 3600_000) } });
    }
    // same transaction the disconnect API performs
    await prisma.$transaction([
      prisma.socialConnection.updateMany({ where: { accountId: accounts[0].id }, data: { status: 'DISCONNECTED', canPublish: false } }),
      prisma.socialAccount.update({ where: { id: accounts[0].id }, data: { autoPublishEnabled: false, autonomousAuthorized: false } }),
      prisma.publicationJob.updateMany({ where: { accountId: accounts[0].id, state: 'QUEUED' }, data: { state: 'REJECTED' } }),
    ]);
    expect((await prisma.publicationJob.findFirstOrThrow({ where: { accountId: accounts[0].id } })).state).toBe('REJECTED');
    expect((await prisma.publicationJob.findFirstOrThrow({ where: { accountId: accounts[1].id } })).state).toBe('QUEUED');
    expect((await prisma.socialConnection.findUniqueOrThrow({ where: { accountId: accounts[1].id } })).status).toBe('CONNECTED');
  });

  it('per-account settings (language, format) are independent', async () => {
    const { accounts } = await seedBase({ accounts: 2 });
    expect(accounts[0].language).toBe('ar');
    expect(accounts[1].language).toBe('en');
    const { generateAdvertisement } = await import('@/lib/pipeline/generate');
    const [a, b] = [await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't' }), await generateAdvertisement({ accountId: accounts[1].id, createdBy: 't' })];
    expect(a.advertisement.language).toBe('ar');
    expect(b.advertisement.language).toBe('en');
    expect(a.qc?.checks.find((c) => c.id === 'language_match')?.passed).toBe(true);
    expect(b.qc?.checks.find((c) => c.id === 'language_match')?.passed).toBe(true);
  });
});

describe('one-click Metricool linking', () => {
  it('links each brand to a placeholder slot (named after the brand), is idempotent, never enables auto-publish', async () => {
    const { linkAllBrands } = await import('@/lib/publishing/link');
    const { accounts } = await seedBase({ accounts: 3, connected: false });
    const adapter = { listProfiles: async () => [
      { brandId: '7680808', label: 'bhfcc.mugs', timezone: 'Asia/Bahrain', networks: [{ network: 'instagram' as const, handle: 'bhfcc.mugs' }] },
      { brandId: '7839816', label: '@bhfcc.education', networks: [{ network: 'instagram' as const, handle: 'bhfcc.education' }, { network: 'facebook' as const, id: '1' }] },
      { brandId: '999', label: 'empty', networks: [] },
    ] } as never;
    const r1 = await linkAllBrands(adapter);
    expect(r1.map((x) => x.action)).toEqual(['linked', 'linked', 'skipped']);
    const a0 = await prisma.socialAccount.findUniqueOrThrow({ where: { id: accounts[0].id }, include: { connection: true } });
    expect(a0).toMatchObject({ name: 'bhfcc.mugs', handle: 'bhfcc.mugs', autoPublishEnabled: false });
    expect(a0.connection).toMatchObject({ providerBrandId: '7680808', status: 'CONNECTED', canPublish: true });
    expect((await prisma.socialAccount.findUniqueOrThrow({ where: { id: accounts[1].id } })).name).toBe('bhfcc.education');
    const r2 = await linkAllBrands(adapter);
    expect(r2.map((x) => x.action)).toEqual(['refreshed', 'refreshed', 'skipped']);
    expect(await prisma.socialConnection.count()).toBe(2);
  });
});

describe('connection health check', () => {
  it('stops publishing for accounts whose network vanished in Metricool, restores them when back', async () => {
    const { verifyConnections } = await import('@/lib/publishing/health');
    const { accounts } = await seedBase({ accounts: 2 });
    const brands = (withSecond: boolean) => ({ listProfiles: async () => [
      { brandId: '1000', label: 'a', networks: [{ network: 'instagram' as const }] },
      { brandId: '1001', label: 'b', networks: withSecond ? [{ network: 'instagram' as const }] : [] },
    ] }) as never;
    expect(await verifyConnections(brands(false))).toEqual({ ok: 1, lost: 1, restored: 0 });
    const c = await prisma.socialConnection.findUniqueOrThrow({ where: { accountId: accounts[1].id } });
    expect(c).toMatchObject({ status: 'INSUFFICIENT_PERMISSIONS', canPublish: false });
    expect(await prisma.notification.count({ where: { code: 'CONNECTION_LOST' } })).toBe(1);
    expect(await verifyConnections(brands(true))).toEqual({ ok: 1, lost: 0, restored: 1 });
    expect((await prisma.socialConnection.findUniqueOrThrow({ where: { accountId: accounts[1].id } })).canPublish).toBe(true);
  });
});
