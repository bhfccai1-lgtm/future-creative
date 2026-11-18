import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { updateSettings } from '@/lib/settings';
import { generateAdvertisement, pickArt } from '@/lib/pipeline/generate';
import { setAiProviderOverride } from '@/lib/ai';
import { rejectAdvertisement, approveAdvertisement } from '@/lib/publishing/jobs';
import { tasteProfile, withoutBlocked } from '@/lib/creative/taste';
import type { BriefRequest } from '@/lib/ai/types';
import { captureQueues, FakeAiProvider, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });

class Recording extends FakeAiProvider { reqs: BriefRequest[] = []; async generateBrief(req: BriefRequest) { this.reqs.push(req); return super.generateBrief(req); } }

describe('learns from the owner\'s taste', () => {
  it('rejection reasons + standing guidance reach the designer; rejected headlines are never proposed again; a concept rejected 3× leaves the rotation', async () => {
    const { accounts, admin } = await seedBase({ productCount: 20, settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false, maxDailyAds: 100 } }) });
    await prisma.socialAccount.updateMany({ data: { maxDailyAds: 50 } });
    const p = new Recording(); setAiProviderOverride(p);
    await updateSettings((s) => ({ ...s, ai: { ...s.ai, ownerGuidance: 'ألوان فاتحة وبدون وجوه أشخاص' } }));
    const user = { id: admin.id, email: admin.email };
    const rejected: string[] = [];
    for (let i = 0; i < 3; i++) {
      const ad = (await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'IMAGE_FEED', direction: { concept: 'levitation' } })).advertisement;
      await rejectAdvertisement(ad.id, user, i === 0 ? 'الخلفية داكنة جدًا' : undefined);
      rejected.push(ad.headline!);
    }
    const ok = (await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'IMAGE_FEED', direction: { concept: 'paper_craft' } })).advertisement;
    await approveAdvertisement(ok.id, user);

    const t = await tasteProfile();
    expect(t.decisions).toBe(4);
    expect(t.feedback).toEqual(['ألوان فاتحة وبدون وجوه أشخاص', 'الخلفية داكنة جدًا']);
    expect(t.blocked.concept).toEqual(['levitation']);
    expect(t.avoid.headlines).toEqual(expect.arrayContaining(rejected));

    p.reqs.length = 0;
    await generateAdvertisement({ accountId: accounts[1].id, createdBy: 't', format: 'IMAGE_FEED' });
    expect(p.reqs[0].ownerFeedback).toEqual(t.feedback);
    expect(p.reqs[0].avoidHeadlines).toEqual(expect.arrayContaining(rejected)); // they used to drop out of the avoid list

    for (let i = 0; i < 12; i++) expect((await pickArt(accounts[1].id, { aiFull: false, concepts: true, blockedConcepts: t.blocked.concept })).concept).not.toBe('levitation');
    expect((await pickArt(accounts[1].id, { aiFull: false, concepts: true, concept: 'levitation', blockedConcepts: t.blocked.concept })).concept).toBe('levitation'); // an explicit choice is respected
  });
  it('automatic approvals do not count as taste; the pool is never emptied', async () => {
    await seedBase();
    expect((await tasteProfile()).decisions).toBe(0);
    expect(withoutBlocked(['a', 'b'], ['a', 'b'])).toEqual(['a', 'b']);
    expect(withoutBlocked(['a', 'b'], ['a'])).toEqual(['b']);
  });
});
