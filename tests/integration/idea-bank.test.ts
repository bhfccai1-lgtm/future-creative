import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { updateSettings } from '@/lib/settings';
import { generateAdvertisement } from '@/lib/pipeline/generate';
import { setAiProviderOverride } from '@/lib/ai';
import { generateFromBank, generateIdeas, takeApprovedIdea, weeklyIdeas } from '@/lib/ideas/bank';
import type { BriefRequest } from '@/lib/ai/types';
import { captureQueues, FakeAiProvider, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });

class IdeaProvider extends FakeAiProvider {
  last: BriefRequest | null = null;
  async suggestIdeas(req: BriefRequest, _m: string, count: number) {
    this.last = req;
    const ideas = Array.from({ length: count }, (_, i) => ({ title: `فكرة ${i}`, idea: `وصف ${i}`, hook: `افتتاحية ${i}`, angle: req.ideaContext!.angles![i].split(':')[0], format: i === 0 ? 'REEL_VIDEO' : 'IMAGE_CAROUSEL', score: 9 - i, why: 'سبب' }));
    return { ideas, usage: { inputTokens: 1000, outputTokens: 300 }, model: 'fake-text' };
  }
}

describe('idea bank', () => {
  it('generates rated ideas with distinct angles, and rotates angles across batches', async () => {
    const { accounts } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false } }) });
    const p = new IdeaProvider(); setAiProviderOverride(p);
    const a = await generateIdeas(accounts[0].id, { count: 4 });
    expect(a).toHaveLength(4);
    expect(new Set(a.map((i) => i.angle)).size).toBe(4);
    expect(a[0]).toMatchObject({ hook: 'افتتاحية 0', format: 'REEL_VIDEO', score: 9, status: 'NEW', source: 'weekly' });
    const b = await generateIdeas(accounts[0].id, { count: 4 });
    expect(b.filter((i) => a.some((x) => x.angle === i.angle))).toHaveLength(0); // least-recently-used angles
    expect(p.last!.avoidHeadlines).toEqual(expect.arrayContaining(['فكرة 0'])); // the bank itself is in the avoid list
  });
  it('auto-approve by score; scheduler takes the best approved idea once (product, growth-mix format, idea text)', async () => {
    const { accounts } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false } }) });
    setAiProviderOverride(new IdeaProvider());
    await updateSettings((s) => ({ ...s, ideas: { ...s.ideas, autoApproveMinScore: 8 } }));
    await prisma.socialAccount.update({ where: { id: accounts[0].id }, data: { formatStrategy: 'GROWTH_MIX' } });
    const ideas = await generateIdeas(accounts[0].id, { count: 3 });
    expect(ideas.map((i) => i.status)).toEqual(['APPROVED', 'APPROVED', 'NEW']); // scores 9, 8, 7
    const r = await generateFromBank({ accountId: accounts[0].id, createdBy: 'scheduler' }, (d) => generateAdvertisement(d as never));
    expect(r.advertisement.format).toBe('REEL_VIDEO');
    expect(r.advertisement.productId).toBe(ideas[0].productId);
    const used = await prisma.idea.findUniqueOrThrow({ where: { id: ideas[0].id } });
    expect(used).toMatchObject({ status: 'USED', usedAdId: r.advertisement.id });
    const ad = await prisma.advertisement.findUniqueOrThrow({ where: { id: r.advertisement.id } });
    expect(((ad.options as { direction: { idea: string } }).direction.idea)).toMatch(/فكرة 0.*افتتاحية 0/);
    expect((await takeApprovedIdea(accounts[0].id))!.idea.id).toBe(ideas[1].id);
    expect(await takeApprovedIdea(accounts[0].id)).toBeNull();
  });
  it('a failed generation gives the idea back; weekly is skipped in dry-run', async () => {
    const { accounts } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false } }) });
    setAiProviderOverride(new IdeaProvider());
    const [i] = await generateIdeas(accounts[0].id, { count: 1 });
    await prisma.idea.update({ where: { id: i.id }, data: { status: 'APPROVED' } });
    await expect(generateFromBank({ accountId: accounts[0].id }, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect((await prisma.idea.findUniqueOrThrow({ where: { id: i.id } })).status).toBe('APPROVED');
    setAiProviderOverride(null);
    await updateSettings((s) => ({ ...s, ai: { ...s.ai, dryRun: true } }));
    expect(await weeklyIdeas()).toEqual({ skipped: 'dry_run' });
  });
});
