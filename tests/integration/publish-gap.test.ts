import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { generateAdvertisement } from '@/lib/pipeline/generate';
import { setAiProviderOverride } from '@/lib/ai';
import { setPublishingAdapterOverride } from '@/lib/publishing/registry';
import { createPublicationJob } from '@/lib/publishing/jobs';
import { updateSettings } from '@/lib/settings';
import { captureQueues, FakeAdapter, FakeAiProvider, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });
async function approvedAds(n: number, accountId: string) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = await generateAdvertisement({ accountId, createdBy: 't', format: 'IMAGE_FEED' });
    await prisma.advertisement.update({ where: { id: r.advertisement.id }, data: { state: 'APPROVED' } });
    ids.push(r.advertisement.id);
  }
  return ids;
}
const MIN = 60_000;

describe('minimum gap between posts on one account', () => {
  it('a second post at the same time moves 30 min later; other accounts are not affected', async () => {
    const { accounts } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false, maxDailyAds: 100 } }) });
    setAiProviderOverride(new FakeAiProvider()); setPublishingAdapterOverride(new FakeAdapter());
    const t = new Date(Date.now() + 3 * 3600_000);
    const [a, b] = await approvedAds(2, accounts[0].id);
    const [c] = await approvedAds(1, accounts[1].id);
    const ja = await createPublicationJob(a, t, 't'), jb = await createPublicationJob(b, t, 't'), jc = await createPublicationJob(c, t, 't');
    expect(ja.scheduledFor.getTime()).toBe(t.getTime());
    expect(jb.scheduledFor.getTime() - ja.scheduledFor.getTime()).toBe(30 * MIN);
    expect(jc.scheduledFor.getTime()).toBe(t.getTime());
  });
  it('simultaneous requests (campaign + schedule race) never land closer than the gap', async () => {
    const { accounts } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false, maxDailyAds: 100 } }) });
    setAiProviderOverride(new FakeAiProvider()); setPublishingAdapterOverride(new FakeAdapter());
    const t = new Date(Date.now() + 3 * 3600_000);
    const ids = await approvedAds(3, accounts[0].id);
    const jobs = await Promise.all(ids.map((id) => createPublicationJob(id, new Date(t.getTime() + 5 * MIN), 't')));
    const times = jobs.map((j) => j.scheduledFor.getTime()).sort((x, y) => x - y);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(30 * MIN);
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(30 * MIN);
  });
  it('a failed post frees its slot; gap 0 disables the guard', async () => {
    const { accounts } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false, maxDailyAds: 100 } }) });
    setAiProviderOverride(new FakeAiProvider()); setPublishingAdapterOverride(new FakeAdapter());
    const t = new Date(Date.now() + 3 * 3600_000);
    const [a, b, c] = await approvedAds(3, accounts[0].id);
    const ja = await createPublicationJob(a, t, 't');
    await prisma.publicationJob.update({ where: { id: ja.id }, data: { state: 'FAILED' } });
    expect((await createPublicationJob(b, t, 't')).scheduledFor.getTime()).toBe(t.getTime());
    await updateSettings((s) => ({ ...s, publishing: { ...s.publishing, minGapMinutes: 0 } }));
    expect((await createPublicationJob(c, t, 't')).scheduledFor.getTime()).toBe(t.getTime());
  });
});
