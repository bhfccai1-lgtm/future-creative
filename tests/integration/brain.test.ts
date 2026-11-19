import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/db';
import { brainGuidance, brainOf, learnBrains, learnRules, MIN_N } from '@/lib/growth/brain';
import { accountPlans, type PlanPost } from '@/lib/growth/account-plan';
import { generateAdvertisement, pickArt } from '@/lib/pipeline/generate';
import { setAiProviderOverride } from '@/lib/ai';
import type { BriefRequest } from '@/lib/ai/types';
import { captureQueues, FakeAiProvider, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });
afterEach(() => { vi.restoreAllMocks(); });
const NOW = new Date('2026-11-19T12:00:00Z');

async function post(accountId: string, productId: string, i: number, caption: string, m: Record<string, number>) {
  const ad = await prisma.advertisement.create({ data: { accountId, productId, format: 'REEL_VIDEO', language: 'ar', state: 'PUBLISHED', caption, headline: caption.slice(0, 20), createdBy: 't' } });
  const at = new Date(NOW.getTime() - (20 - i) * 86400_000);
  const job = await prisma.publicationJob.create({ data: { idempotencyKey: `k-${accountId}-${i}`, advertisementId: ad.id, accountId, provider: 'metricool', state: 'PUBLISHED', scheduledFor: at } });
  await prisma.publicationResult.create({ data: { jobId: job.id, verifiedAt: at, metrics: m, metricsFetchedAt: NOW, metricsSource: 'metricool' } });
}
const row = (hook: string, views: number) => ({ p: { adId: 'x', hook, headline: null, format: 'REEL_VIDEO', publishedAt: '', product: '', category: '', views, reach: views, likes: 0, comments: 0, saves: 0, shares: 0, retention: 50, skip: 50 } as PlanPost, hour: 20, occasion: false, captionLen: 100, category: 'أكواب' });
class Recording extends FakeAiProvider { reqs: BriefRequest[] = []; async generateBrief(req: BriefRequest) { this.reqs.push(req); return super.generateBrief(req); } }

describe('🧠 account brain (learn → apply → explore)', () => {
  it('🎨 visual memory: learns the winning concept/lighting and steers the next image toward it', async () => {
    const vis = (concept: string, lighting: string, views: number) => ({ ...row('جملة', views), art: { concept, lighting, composition: 'hero_product' } });
    const rows = [...Array.from({ length: 3 }, () => vis('levitation', 'golden_hour', 600)), ...Array.from({ length: 3 }, () => vis('paper_craft', 'softbox', 100))];
    const rules = learnRules(rows);
    expect(rules.find((r) => r.dim === 'concept')).toMatchObject({ visual: 'concept', best: 'levitation', worst: 'paper_craft', prompt: '' });
    expect(rules.find((r) => r.dim === 'lighting')?.ar).toMatch(/ضوء الغروب الذهبي/);
    expect(rules.find((r) => r.dim === 'composition')).toBeUndefined(); // one value only → nothing to compare
    const { accounts } = await seedBase();
    await prisma.systemSetting.create({ data: { key: `brain:${accounts[0].id}`, value: { accountId: accounts[0].id, at: NOW.toISOString(), posts: 6, rules } as never, updatedBy: 'brain' } });
    const g = await brainGuidance(accounts[0].id, () => 0.9);
    expect(g).toMatchObject({ mode: 'apply', text: null, art: { concept: 'levitation', lighting: 'golden_hour' } }); // visual-only memory: no copy instruction
    expect((await brainGuidance(accounts[0].id, () => 0.1)).art).toEqual({}); // exploring: free choice
    const art = await pickArt(accounts[0].id, { aiFull: false, concepts: true, prefer: g.art });
    expect(art).toMatchObject({ concept: 'levitation', lighting: 'golden_hour' });
    // a winner the owner blocked, or an explicit choice, always wins over the memory
    expect((await pickArt(accounts[0].id, { aiFull: false, concepts: true, prefer: g.art, blockedConcepts: ['levitation'] })).concept).not.toBe('levitation');
    expect((await pickArt(accounts[0].id, { aiFull: false, concepts: true, prefer: g.art, concept: 'paper_craft' })).concept).toBe('paper_craft');
  });

  it('learnRules keeps a rule only with enough posts on both sides and a real lift', () => {
    const rows = [...Array.from({ length: 3 }, () => row('البحرين في كل رشفة!', 300)), ...Array.from({ length: 3 }, () => row('منو يستاهل هدية؟', 100))];
    const hook = learnRules(rows).find((r) => r.dim === 'hook');
    expect(hook).toMatchObject({ best: 'statement', worst: 'question', nBest: 3, nWorst: 3 });
    expect(hook!.ar).toMatch(/الافتتاحية بجملة/);
    expect(hook!.prompt).toMatch(/NOT with a question/);
    expect(learnRules(rows.slice(1)).find((r) => r.dim === 'hook')).toBeUndefined(); // 2 vs 3 < MIN_N
    expect(MIN_N).toBe(3);
    const flat = [...Array.from({ length: 3 }, () => row('جملة', 100)), ...Array.from({ length: 3 }, () => row('سؤال؟', 95))];
    expect(learnRules(flat).find((r) => r.dim === 'hook')).toBeUndefined(); // a 5 % difference is noise
    const tr = [...Array.from({ length: 3 }, () => ({ ...row('جملة', 500), trend: true })), ...Array.from({ length: 3 }, () => ({ ...row('جملة', 100), trend: false }))];
    expect(learnRules(tr).find((r) => r.dim === 'trend')).toMatchObject({ best: 'trend', worst: 'regular' });
  });

  it('learns nightly from real numbers, shows it in the plan, and steers the next design (1 in 5 explores)', async () => {
    const { accounts } = await seedBase({ productCount: 5, settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false, maxDailyAds: 100 } }) });
    await prisma.socialAccount.updateMany({ data: { maxDailyAds: 50 } });
    const product = await prisma.product.findFirstOrThrow();
    const acc = accounts[0];
    for (let i = 0; i < 4; i++) await post(acc.id, product.id, i, `البحرين في كل رشفة ${i}!\nكوبك بتصميمك`, { views: 400, reach: 300, saves: 3, retentionPct: 80 });
    for (let i = 4; i < 8; i++) await post(acc.id, product.id, i, `منو يستاهل هدية اليوم ${i}؟\nكوب بتصميم خاص`, { views: 90, reach: 80, retentionPct: 20 });

    expect(await brainGuidance(acc.id)).toEqual({ text: null, mode: 'none', rules: [], art: {} }); // nothing learnt yet
    const r = await learnBrains(NOW);
    expect(r.accounts).toBe(1);
    const b = await brainOf(acc.id);
    expect(b?.posts).toBe(8);
    expect(b?.rules.find((x) => x.dim === 'hook')).toMatchObject({ best: 'statement', nBest: 4, nWorst: 4 });

    const [plan] = await accountPlans({ now: NOW, accountId: acc.id });
    expect(plan.brain?.rules.some((x) => /الافتتاحية بجملة/.test(x.ar))).toBe(true);

    expect((await brainGuidance(acc.id, () => 0.1)).mode).toBe('explore');
    const g = await brainGuidance(acc.id, () => 0.9);
    expect(g.mode).toBe('apply'); expect(g.text).toMatch(/^PERFORMANCE MEMORY/); expect(g.rules).toContain('hook');

    const p = new Recording(); setAiProviderOverride(p);
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const ad = (await generateAdvertisement({ accountId: acc.id, createdBy: 't', format: 'IMAGE_FEED' })).advertisement;
    expect(p.reqs.at(-1)?.ownerFeedback?.some((f) => /PERFORMANCE MEMORY/.test(f))).toBe(true);
    expect((ad.options as { brain?: { mode: string } }).brain?.mode).toBe('apply');
    // another account has no brain → nothing injected
    p.reqs.length = 0;
    await generateAdvertisement({ accountId: accounts[1].id, createdBy: 't', format: 'IMAGE_FEED' });
    expect(p.reqs.at(-1)?.ownerFeedback?.some((f) => /PERFORMANCE MEMORY/.test(f)) ?? false).toBe(false);
  });
});
