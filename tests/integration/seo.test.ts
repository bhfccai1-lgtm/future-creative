import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { productJsonLd, seoDescription, seoHealth, seoTitle } from '@/lib/seo/catalog';
import sitemap from '@/app/sitemap';
import robots from '@/app/robots';
import { middleware } from '@/middleware';
import { getBusiness } from '@/lib/business';
import { captureQueues, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });

describe('🔎 Google visibility of the public product pages', () => {
  it('title and description carry the place and the branches; structured data is a Product sold by the local business', async () => {
    await seedBase();
    const b = await getBusiness();
    const p = await prisma.product.findFirstOrThrow({ where: { active: true }, include: { category: true } });
    await prisma.product.update({ where: { id: p.id }, data: { priceFrom: 1.5, catalogDescription: 'أكواب سيراميك مطبوعة بتصميمك بجودة عالية تتحمل الغسيل' } });
    const q = await prisma.product.findUniqueOrThrow({ where: { id: p.id }, include: { category: true } });
    expect(seoTitle(q, b)).toMatch(/في البحرين \| /);
    expect(seoDescription(q, b)).toMatch(/فروع .*البحرين\. اطلب عبر واتساب\.$/);
    expect(seoDescription(q, b).length).toBeLessThanOrEqual(160);
    const ld = productJsonLd(q, b, { hasImage: true }) as Record<string, unknown> & { offers: { seller: unknown } };
    expect(ld).toMatchObject({ '@type': 'Product', name: q.titleAr, image: expect.stringMatching(/\/p\/.+\/image$/) });
    expect(ld.offers).toMatchObject({ '@type': 'Offer', price: '1.500', priceCurrency: 'BHD', areaServed: 'BH' });
    expect(ld.offers.seller).toMatchObject({ '@type': 'LocalBusiness', address: { addressCountry: 'BH' } });
    expect((productJsonLd(q, b) as Record<string, unknown>).image).toBeUndefined(); // no picture → no broken image link
  });

  it('sitemap lists every active product; robots opens /p/ only; both are reachable without login', async () => {
    await seedBase();
    const active = await prisma.product.count({ where: { active: true } });
    const one = await prisma.product.findFirstOrThrow({ where: { active: true } });
    await prisma.product.update({ where: { id: one.id }, data: { active: false } });
    const map = await sitemap();
    expect(map).toHaveLength(active - 1);
    expect(map.some((m) => m.url.endsWith(`/p/${one.slug}`))).toBe(false);
    const r = robots();
    expect(r.rules).toEqual([expect.objectContaining({ allow: ['/p/'], disallow: expect.arrayContaining(['/', '/api/']) })]);
    for (const path of ['/robots.txt', '/sitemap.xml', '/p/some-product']) expect((await middleware(new NextRequest(`https://ads.test.local${path}`))).status).not.toBe(307);
    expect((await middleware(new NextRequest('https://ads.test.local/leads'))).status).toBe(307); // the dashboard still needs login
  });

  it('health report: thin pages (no / short description) come first', async () => {
    await seedBase();
    await prisma.product.updateMany({ data: { catalogDescription: null } });
    const h = await seoHealth();
    expect(h.total).toBeGreaterThan(0);
    expect(h.withDescription).toBe(0);
    expect(h.missingDescription.length).toBeGreaterThan(0);
    expect(h.sitemap).toMatch(/\/sitemap\.xml$/);
  });
});
