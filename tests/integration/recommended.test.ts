import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { applyRecommended, planRecommended } from '@/lib/ops/recommended';
import { resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); });
describe('recommended one-click setup', () => {
  it('7h + growth mix for all; niche categories by account name; main/branch accounts keep all; chosen categories untouched', async () => {
    const { accounts } = await seedBase({ accounts: 4 });
    const cats = await prisma.productCategory.findMany();
    const mugs = cats.find((c) => c.nameAr === 'طباعة الأكواب')!;
    await prisma.socialAccount.update({ where: { id: accounts[0].id }, data: { name: 'bhfcc.mugs' } });
    await prisma.socialAccount.update({ where: { id: accounts[1].id }, data: { name: 'bhfcc.saar' } });
    await prisma.socialAccount.update({ where: { id: accounts[2].id }, data: { name: 'bhfcc.education' } });
    await prisma.socialAccount.update({ where: { id: accounts[3].id }, data: { name: 'bhfcc.stickers', allowedCategoryIds: [mugs.id] } });
    const plan = await planRecommended();
    expect(plan.find((r) => r.name === 'bhfcc.mugs')!.categories).toContain('طباعة الأكواب');
    expect(plan.find((r) => r.name === 'bhfcc.saar')!).toMatchObject({ niche: null, categories: [] });
    expect(plan.find((r) => r.name === 'bhfcc.stickers')!.keepsExisting).toBe(true);
    expect(await prisma.socialAccount.count({ where: { formatStrategy: 'GROWTH_MIX' } })).toBe(0); // preview writes nothing
    await applyRecommended();
    const after = await prisma.socialAccount.findMany();
    for (const a of after) expect(a).toMatchObject({ publishIntervalMinutes: 420, maxDailyAds: 4, formatStrategy: 'GROWTH_MIX' });
    expect(after.find((a) => a.name === 'bhfcc.mugs')!.allowedCategoryIds).toContain(mugs.id);
    expect(after.find((a) => a.name === 'bhfcc.saar')!.allowedCategoryIds).toEqual([]);
    expect(after.find((a) => a.name === 'bhfcc.stickers')!.allowedCategoryIds).toEqual([mugs.id]);
    expect(after.find((a) => a.name === 'bhfcc.education')!.allowedCategoryIds.length).toBeGreaterThan(0);
  });
});
