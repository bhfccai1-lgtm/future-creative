import { beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { prisma } from '@/lib/db';
import { updateSettings } from '@/lib/settings';
import { generateAdvertisement } from '@/lib/pipeline/generate';
import { setAiProviderOverride } from '@/lib/ai';
import { setPublishingAdapterOverride } from '@/lib/publishing/registry';
import { queueCrossPromo, renderCrossStory } from '@/lib/promo/cross-story';
import { captureQueues, FakeAdapter, FakeAiProvider, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });
async function setup(autonomous = false) {
  const { accounts } = await seedBase({ accounts: 3, settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false }, ...(autonomous ? { publishingMode: 'AUTONOMOUS', autonomousAuthorizedAt: new Date().toISOString() } : {}) }) });
  setAiProviderOverride(new FakeAiProvider()); setPublishingAdapterOverride(new FakeAdapter());
  await updateSettings((s) => ({ ...s, publishing: { ...s.publishing, crossPromo: { enabled: true, maxPerTargetPerDay: 1, delayMinutes: 45 } } }));
  await prisma.socialAccount.update({ where: { id: accounts[0].id }, data: { handle: 'bhfcc.mugs', promoteToIds: [accounts[1].id, accounts[2].id] } });
  if (autonomous) await prisma.socialAccount.update({ where: { id: accounts[1].id }, data: { autonomousAuthorized: true, autoPublishEnabled: true } });
  return accounts;
}

describe('same-brand cross-promotion stories', () => {
  it('renders a readable branded story (1080×1920) with the handle', async () => {
    const img = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#335' } }).png().toBuffer();
    const logo = await sharp({ create: { width: 400, height: 160, channels: 4, background: '#d4af37' } }).png().toBuffer();
    const r = await renderCrossStory({ image: img, logo, handle: 'bhfcc.mugs', headline: 'أكواب بتصميمك الخاص', lang: 'ar' });
    expect(r.fits).toBe(true);
    expect(await sharp(r.jpeg).metadata()).toMatchObject({ width: 1080, height: 1920 });
  });
  it('a published feed post creates one promo story per chosen account (approval queue), respects the daily cap and never promotes stories', async () => {
    const accounts = await setup();
    const feed = (await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'IMAGE_FEED' })).advertisement;
    const ids = await queueCrossPromo(feed.id);
    expect(ids).toHaveLength(2);
    const promos = await prisma.advertisement.findMany({ where: { id: { in: ids } }, include: { approvals: true, media: true } });
    for (const p of promos) {
      expect(p).toMatchObject({ format: 'IMAGE_STORY', state: 'QUALITY_REVIEW', createdBy: 'cross-promo', qcPassed: true });
      expect(p.approvals).toHaveLength(1);
      expect(p.media[0].role).toBe('FINAL');
    }
    const feed2 = (await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'IMAGE_FEED' })).advertisement;
    expect(await queueCrossPromo(feed2.id)).toHaveLength(0); // cap 1/day per target
    const story = (await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'IMAGE_STORY' })).advertisement;
    expect(await queueCrossPromo(story.id)).toHaveLength(0);
    expect(await queueCrossPromo(ids[0])).toHaveLength(0); // a promotion is never promoted
  });
  it('autonomous target: auto-approved and queued after the delay; disabled → nothing', async () => {
    const accounts = await setup(true);
    const feed = (await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'IMAGE_FEED' })).advertisement;
    const ids = await queueCrossPromo(feed.id);
    const job = await prisma.publicationJob.findFirst({ where: { advertisementId: { in: ids }, accountId: accounts[1].id } });
    expect(job).not.toBeNull();
    expect(job!.scheduledFor.getTime()).toBeGreaterThan(Date.now() + 40 * 60_000);
    await updateSettings((s) => ({ ...s, publishing: { ...s.publishing, crossPromo: { ...s.publishing.crossPromo, enabled: false } } }));
    const feed2 = (await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'IMAGE_FEED' })).advertisement;
    expect(await queueCrossPromo(feed2.id)).toHaveLength(0);
  });
});
