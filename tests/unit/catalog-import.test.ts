import { describe, expect, it } from 'vitest';
import { parseProductCsv, withDefaults, sheetsCsvUrl, slugify } from '@/lib/catalog/import';
import { chooseProduct, productAllowed, allowedWhere } from '@/lib/creative/selector';
import type { Product } from '@prisma/client';

describe('catalogue CSV import', () => {
  it('accepts Arabic headers with only name + category and fills defaults', () => {
    const csv = '﻿الفئة,الاسم,الاسم بالإنجليزية\r\nأكواب,كوب سيراميك مطبوع,Printed Ceramic Mug\r\nخدمات,تصميم شعار,\r\n';
    const { rows, errors } = parseProductCsv(csv);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ slug: 'printed-ceramic-mug', category: 'أكواب', titleAr: 'كوب سيراميك مطبوع', active: true });
    expect(rows[1].slug).toMatch(/^p-[0-9a-f]{10}$/);
    const d = withDefaults(rows[1]);
    expect(d.targetAudience.length).toBeGreaterThan(0);
    expect(d.visualGuidelines.length).toBeGreaterThan(10);
    expect(d.recommendedMessages.ar[0]).toContain('تصميم شعار');
  });
  it('arabic-only slug is stable across imports', () => {
    const a = parseProductCsv('category,titleAr\nخدمات,طباعة بنرات\n').rows[0].slug;
    const b = parseProductCsv('category,titleAr\nخدمات,طباعة بنرات\n').rows[0].slug;
    expect(a).toBe(b);
  });
  it('reports duplicates, empty names, price claims and inactive flags per line', () => {
    const csv = ['category,titleEn,messagesAr,active', 'Mugs,Magic Mug,,1', 'Mugs,Magic Mug,,1', 'Mugs,,,1', 'Mugs,Cheap Cup,خصم 50% اليوم,1', 'Mugs,Old Item,,لا'].join('\n');
    const { rows, errors } = parseProductCsv(csv);
    expect(rows.map((r) => r.slug)).toEqual(['magic-mug', 'old-item']);
    expect(rows[1].active).toBe(false);
    expect(errors.map((e) => e.line)).toEqual([3, 4, 5]);
    expect(errors[0].message).toMatch(/مكرر/);
  });
  it('lists split on | and Arabic comma', () => {
    const r = parseProductCsv('category,titleEn,audience\nX,Flyer,شركات | مدارس، أفراد\n').rows[0];
    expect(r.audience).toEqual(['شركات', 'مدارس', 'أفراد']);
  });
  it('rejects a file without a name column', () => {
    expect(parseProductCsv('category,price\nX,5\n').errors[0].message).toMatch(/عمود/);
  });
  it('google sheets link → CSV export url', () => {
    expect(sheetsCsvUrl('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz12345/edit#gid=77')).toBe('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz12345/export?format=csv&gid=77');
    expect(sheetsCsvUrl('https://example.com/x.csv')).toBeNull();
    expect(slugify('Business Cards & Flyers')).toBe('business-cards-and-flyers');
  });
});

describe('category allowance + rotation', () => {
  const acc = (ids: string[], cats: string[]) => ({ allowedProductIds: ids, allowedCategoryIds: cats });
  it('empty = all, otherwise product id OR category', () => {
    expect(productAllowed(acc([], []), { id: 'p1', categoryId: 'c1' })).toBe(true);
    expect(productAllowed(acc([], ['c1']), { id: 'p1', categoryId: 'c1' })).toBe(true);
    expect(productAllowed(acc(['p2'], ['c9']), { id: 'p1', categoryId: 'c1' })).toBe(false);
    expect(productAllowed(acc(['p1'], ['c9']), { id: 'p1', categoryId: 'c1' })).toBe(true);
    expect(allowedWhere(acc([], []))).toEqual({});
    expect(allowedWhere(acc(['p1'], ['c1']))).toEqual({ OR: [{ id: { in: ['p1'] } }, { categoryId: { in: ['c1'] } }] });
  });
  it('never repeats any of the last 10 products in a large catalogue', () => {
    const ps = Array.from({ length: 600 }, (_, i) => ({ id: `p${i}`, performanceScore: 0 }) as Product);
    const recent = ps.slice(0, 10).map((p) => p.id);
    let seed = 1; const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 300; i++) expect(recent).not.toContain(chooseProduct(ps, recent, rng)!.id);
  });
  it('small catalogue still works (2 products alternate)', () => {
    const ps = [{ id: 'a', performanceScore: 0 }, { id: 'b', performanceScore: 0 }] as Product[];
    expect(chooseProduct(ps, ['a'], () => 0.5)!.id).toBe('b');
  });
});

describe('bundled catalogue presets', () => {
  it('lists the shipped CSV, reads it, and refuses path traversal', async () => {
    const { listPresets, readPreset } = await import('@/lib/catalog/import');
    const list = await listPresets();
    expect(list).toContain('additional-products-2026-11.csv');
    const text = (await readPreset('additional-products-2026-11.csv'))!;
    const { rows, errors } = parseProductCsv(text);
    expect(errors).toEqual([]);
    expect(rows.length).toBe(93);
    expect(await readPreset('../../.env')).toBeNull();
  });
});
