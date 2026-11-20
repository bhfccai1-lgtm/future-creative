import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { accountPlans, approvePlanIdeas, isQuestion, metricFields, planIdeasByKey, scriptOf } from '@/lib/growth/account-plan';
import { resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); });
const NOW = new Date('2026-11-19T12:00:00Z');

async function post(accountId: string, productId: string, i: number, caption: string, m: Record<string, number>, format: 'REEL_VIDEO' | 'IMAGE_FEED' = 'REEL_VIDEO') {
  const ad = await prisma.advertisement.create({ data: { accountId, productId, format, language: 'ar', state: 'PUBLISHED', caption, headline: caption.slice(0, 20), createdBy: 't' } });
  const at = new Date(NOW.getTime() - (20 - i) * 86400_000);
  const job = await prisma.publicationJob.create({ data: { idempotencyKey: `k-${accountId}-${i}`, advertisementId: ad.id, accountId, provider: 'metricool', state: 'PUBLISHED', scheduledFor: at } });
  await prisma.publicationResult.create({ data: { jobId: job.id, verifiedAt: at, metrics: m, metricsFetchedAt: NOW, metricsSource: 'metricool' } });
  return ad;
}

describe('accounts plan (content strategist from real numbers)', () => {
  it('finds the best post, the hook problem, language and Saudi-tag issues, and builds executable ideas', async () => {
    const { accounts, admin } = await seedBase();
    const product = await prisma.product.findFirstOrThrow();
    const acc = accounts[0];
    await prisma.socialAccount.update({ where: { id: acc.id }, data: { name: 'bhfcc.ksa', handle: 'bhfcc.ksa', language: 'ar' } });
    const best = await post(acc.id, product.id, 0, 'البحرين في كل رشفة! كوبك بتصميمك\nاسمك على الكوب', { views: 30, reach: 17, likes: 14, saves: 1, retentionPct: 92, skipRatePct: 39 });
    for (let i = 1; i <= 4; i++) await post(acc.id, product.id, i, `منو يستاهل هدية اليوم ${i}؟\nكوب بتصميم خاص #البحرين`, { views: 100 + i, reach: 90 + i, likes: 2, retentionPct: 15, skipRatePct: 88 });
    await post(acc.id, product.id, 5, 'A lovely custom mug for your team, printed in Bahrain today', { views: 5, reach: 4 });
    const [p] = await accountPlans({ now: NOW, accountId: acc.id });
    expect(p.measured).toBe(6);
    expect(p.top?.adId).toBe(best.id);
    expect(p.top?.reason).toMatch(/إكمال 92٪/);
    expect(p.hooks.question.n).toBe(4); expect(p.hooks.question.skip).toBe(88);
    const ids = p.issues.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['hook', 'no_conversation', 'language', 'ksa_tags']));
    expect(p.ideas.map((i) => i.key)).toEqual(expect.arrayContaining(['sequel', 'product_first', 'guide', 'before_after']));
    expect(p.bio).toMatch(/المملكة/);
    // execution: approve two ideas into the bank (idempotent), keys checked on the server
    const chosen = await planIdeasByKey(acc.id, ['sequel', 'guide']);
    const r1 = await approvePlanIdeas(acc.id, chosen, { sub: admin.id, email: admin.email });
    const r2 = await approvePlanIdeas(acc.id, chosen, { sub: admin.id, email: admin.email });
    expect(r1.ids).toHaveLength(2); expect(r2.ids).toEqual(r1.ids);
    expect(await prisma.idea.count({ where: { accountId: acc.id, source: 'plan', status: 'APPROVED' } })).toBe(2);
    const [again] = await accountPlans({ now: NOW, accountId: acc.id });
    expect(again.ideas.find((i) => i.key === 'sequel')?.inBank).toBe(true);
    await expect(planIdeasByKey(acc.id, ['nope'])).rejects.toThrow(/فكرة/);
  });
  it('an account without numbers still gets a starter plan and says the data is thin', async () => {
    const { accounts } = await seedBase();
    const [p] = await accountPlans({ now: NOW, accountId: accounts[1].id });
    expect(p.measured).toBe(0); expect(p.top).toBeNull();
    expect(p.issues[0].id).toBe('little_data');
    expect(p.ideas.length).toBeGreaterThanOrEqual(3);
  });
  it('metricFields: one conversion for plan, brain and Drive (rates rounded unless asked not to)', () => {
    const m = { views: 120, reach: 90, likes: 7, saves: 2, retentionPct: 61.6, skipRatePct: 38.4 };
    expect(metricFields(m)).toEqual({ views: 120, reach: 90, likes: 7, comments: 0, saves: 2, shares: 0, retention: 62, skip: 38 });
    expect(metricFields(m, { roundRates: false })).toMatchObject({ retention: 61.6, skip: 38.4 });
    expect(metricFields(null)).toEqual({ views: 0, reach: 0, likes: 0, comments: 0, saves: 0, shares: 0, retention: null, skip: null });
  });
  it('helpers', () => {
    expect(isQuestion('منو يستاهل هدية؟ 🎁')).toBe(true);
    expect(isQuestion('البحرين في كل رشفة!')).toBe(false);
    expect(scriptOf('ദീപാവലി ആശംസകൾ കസ്റ്റം മഗ്ഗുകൾ')).toBe('ml');
    expect(scriptOf('A lovely custom mug for your team')).toBe('en');
  });
});
