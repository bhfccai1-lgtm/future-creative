import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { applyProductImport, exportProductsCsv, parseProductCsv } from '@/lib/catalog/import';
import { selectProductForAccount } from '@/lib/creative/selector';
import { resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); });

describe('bulk catalogue import (500+)', () => {
  it('dry run writes nothing; commit creates products + categories; re-import updates without duplicates', async () => {
    await seedBase({ productCount: 0 });
    const before = await prisma.productCategory.count();
    const lines = ['الفئة,الاسم,titleEn'];
    for (let i = 0; i < 600; i++) lines.push(`${i % 3 ? 'خدمات التصميم' : 'Mugs'},منتج ${i},Item ${i}`);
    const { rows, errors } = parseProductCsv(lines.join('\n'));
    expect(errors).toEqual([]);
    const dry = await applyProductImport(rows, { dryRun: true, actor: 't' });
    expect(dry).toMatchObject({ total: 600, create: 600, update: 0 });
    expect(await prisma.product.count()).toBe(0);
    const t0 = Date.now();
    await applyProductImport(rows, { dryRun: false, actor: 't' });
    expect(Date.now() - t0).toBeLessThan(30_000);
    expect(await prisma.product.count()).toBe(600);
    expect(await prisma.productCategory.count()).toBeGreaterThan(before);
    const again = await applyProductImport(parseProductCsv(lines.join('\n').replace('منتج 5,', 'منتج معدّل,')).rows, { dryRun: false, actor: 't' });
    expect(again).toMatchObject({ create: 0, update: 600 });
    expect(await prisma.product.count()).toBe(600);
    expect((await prisma.product.findUnique({ where: { slug: 'item-5' } }))!.titleAr).toBe('منتج معدّل');
    // export round-trips through the importer
    const back = parseProductCsv(await exportProductsCsv());
    expect(back.errors).toEqual([]);
    expect(back.rows).toHaveLength(600);
  });
  it('account allowed by category only picks products from that category', async () => {
    const { accounts } = await seedBase({ productCount: 6 });
    const cat = (await prisma.product.findFirst({ include: { category: true } }))!.categoryId;
    await prisma.socialAccount.update({ where: { id: accounts[0].id }, data: { allowedCategoryIds: [cat] } });
    const acc = (await prisma.socialAccount.findUnique({ where: { id: accounts[0].id } }))!;
    for (let i = 0; i < 10; i++) expect((await selectProductForAccount(acc))!.categoryId).toBe(cat);
  });
});
