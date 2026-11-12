import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { generateAdvertisement } from '@/lib/pipeline/generate';
import { setAiProviderOverride } from '@/lib/ai';
import { setPublishingAdapterOverride } from '@/lib/publishing/registry';
import { publishNow } from '@/lib/publishing/jobs';
import { buildPublishRequest, processPublishJob } from '@/lib/publishing/publisher';
import { autoChannelsFor, splitJobs } from '@/lib/publishing/channels';
import { weightedLength } from '@/lib/publishing/caption';
import { captureQueues, FakeAdapter, FakeAiProvider, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });
const snapshot = { label: 'b', networks: ['instagram', 'facebook', 'tiktok', 'threads', 'twitter', 'pinterest', 'linkedin', 'youtube', 'gmb'].map((network) => ({ network })) };

async function setup(autoChannels: string[], pinterestBoard: string | null = null) {
  const base = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false } }) });
  setAiProviderOverride(new FakeAiProvider());
  const adapter = new FakeAdapter(); setPublishingAdapterOverride(adapter);
  const a = base.accounts[0];
  await prisma.socialConnection.update({ where: { accountId: a.id }, data: { providerSnapshot: snapshot } });
  await prisma.socialAccount.update({ where: { id: a.id }, data: { autoChannels: autoChannels as never, pinterestBoard } });
  return { ...base, a, adapter, admin: { id: base.admin.id, email: base.admin.email } };
}

describe('channel rules', () => {
  it('splits short-text networks into their own jobs', () => {
    expect(splitJobs(['instagram', 'facebook', 'twitter', 'threads', 'gmb'])).toEqual([['instagram', 'facebook'], ['twitter'], ['threads'], ['gmb']]);
    expect(splitJobs(['twitter'])).toEqual([['twitter']]);
  });
  it('auto channels: only linked, format-compatible, Pinterest with a board', () => {
    const acc = { platform: 'instagram' as const, autoChannels: ['facebook', 'youtube', 'pinterest', 'twitter', 'snapchat'] as never[], pinterestBoard: null, connection: { providerSnapshot: { networks: [{ network: 'facebook' }, { network: 'youtube' }, { network: 'pinterest' }] } } };
    expect(autoChannelsFor(acc, 'IMAGE_FEED')).toEqual(['facebook']); // youtube needs video, pinterest no board, twitter not linked
    expect(autoChannelsFor(acc, 'REEL_VIDEO')).toEqual(['facebook', 'youtube']);
    expect(autoChannelsFor({ ...acc, pinterestBoard: 'هدايا' }, 'IMAGE_FEED')).toEqual(['facebook', 'pinterest']);
    expect(autoChannelsFor(acc, 'IMAGE_STORY')).toEqual(['facebook']);
  });
});

describe('multi-channel publishing', () => {
  it('a feed post goes to every auto channel; X/Threads/Pinterest get their own fitted text and the Instagram caption stays whole', async () => {
    const { a, adapter, admin } = await setup(['facebook', 'linkedin', 'twitter', 'threads', 'pinterest', 'youtube'], 'هدايا مطبوعة');
    const ad = (await generateAdvertisement({ accountId: a.id, createdBy: 't', format: 'IMAGE_FEED' })).advertisement;
    expect(ad.channels).toEqual(['instagram', 'facebook', 'linkedin', 'twitter', 'threads', 'pinterest']); // no youtube for an image
    await publishNow(ad.id, admin);
    const jobs = await prisma.publicationJob.findMany({ where: { advertisementId: ad.id }, orderBy: { createdAt: 'asc' } });
    expect(jobs.map((j) => [j.networks.join('+'), j.primary])).toEqual([['instagram+facebook+linkedin', true], ['twitter', false], ['threads', false], ['pinterest', false]]);
    const main = await buildPublishRequest(jobs[0].id);
    const x = await buildPublishRequest(jobs[1].id);
    const pin = await buildPublishRequest(jobs[3].id);
    expect(weightedLength(x.text)).toBeLessThanOrEqual(280);
    expect(main.text.length).toBeGreaterThan(x.text.length);
    expect(x.text).toContain('33316319');
    expect(pin).toMatchObject({ pinterestBoard: 'هدايا مطبوعة' });
    expect(pin.link).toMatch(/\/p\/[a-z0-9-]+$/);
    for (const j of jobs) expect(await processPublishJob(j.id, 'w')).toBe('SCHEDULED');
    expect(adapter.submits).toHaveLength(4);
    expect((await prisma.advertisement.findUniqueOrThrow({ where: { id: ad.id } })).state).toBe('SCHEDULED');
  });
  it('a story only goes to Instagram/Facebook', async () => {
    const { a } = await setup(['facebook', 'twitter', 'tiktok']);
    const ad = (await generateAdvertisement({ accountId: a.id, createdBy: 't', format: 'IMAGE_STORY' })).advertisement;
    expect(ad.channels).toEqual(['instagram', 'facebook']);
  });
  it('Pinterest without a board is blocked before submitting', async () => {
    const { a, adapter, admin } = await setup([]);
    const ad = (await generateAdvertisement({ accountId: a.id, createdBy: 't', format: 'IMAGE_FEED', direction: { channels: ['instagram', 'pinterest'] } })).advertisement;
    await publishNow(ad.id, admin);
    const pinJob = await prisma.publicationJob.findFirstOrThrow({ where: { advertisementId: ad.id, primary: false } });
    expect(await processPublishJob(pinJob.id, 'w')).toBe('FAILED');
    expect((await prisma.publicationJob.findUniqueOrThrow({ where: { id: pinJob.id } })).lastError).toMatch(/لوحة Pinterest/);
    expect(adapter.submits.every((s) => !s.networks.includes('pinterest'))).toBe(true);
  });
});
