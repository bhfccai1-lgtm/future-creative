import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { generateAdvertisement, withAutoGbp } from '@/lib/pipeline/generate';
import { runAdvisor } from '@/lib/ops/advisor';
import { captureQueues, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });
describe('automatic Google Business Profile', () => {
  it('adds gmb only when opted in, linked in Metricool, a suitable format, and under the weekly cadence', async () => {
    const { accounts } = await seedBase({ accounts: 1 });
    const a = accounts[0];
    const conn = (snap: unknown) => ({ ...a, gbpAuto: true, gbpPerWeek: 2, connection: { providerSnapshot: snap } });
    const linked = { networks: [{ network: 'instagram' }, { network: 'gmb' }] };
    expect(await withAutoGbp({ ...conn(linked), gbpAuto: false }, 'IMAGE_FEED', [])).toEqual([]);
    expect(await withAutoGbp(conn({ networks: [{ network: 'instagram' }] }), 'IMAGE_FEED', [])).toEqual([]);
    expect(await withAutoGbp(conn(linked), 'IMAGE_STORY', [])).toEqual([]);
    expect(await withAutoGbp(conn(linked), 'IMAGE_CAROUSEL', [])).toEqual([]);
    expect(await withAutoGbp(conn(linked), 'IMAGE_FEED', [])).toEqual(['instagram', 'gmb']);
    expect(await withAutoGbp(conn(linked), 'REEL_VIDEO', ['instagram', 'facebook'])).toEqual(['instagram', 'facebook', 'gmb']);
    // weekly cadence
    await prisma.socialAccount.update({ where: { id: a.id }, data: { gbpAuto: true, gbpPerWeek: 1 } });
    await prisma.socialConnection.update({ where: { accountId: a.id }, data: { providerSnapshot: linked } });
    const first = await generateAdvertisement({ accountId: a.id, createdBy: 'scheduler', format: 'IMAGE_FEED' });
    expect(first.advertisement.channels).toEqual(['instagram', 'gmb']);
    const second = await generateAdvertisement({ accountId: a.id, createdBy: 'scheduler', format: 'IMAGE_FEED' });
    expect(second.advertisement.channels).toEqual([]);
  });
  it('advisor recommends linking Google Business when no brand has it', async () => {
    await seedBase({ accounts: 1 });
    expect((await runAdvisor()).advice.some((x) => x.id === 'gbp_not_linked')).toBe(true);
  });
});
