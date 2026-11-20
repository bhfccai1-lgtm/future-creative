import type { MetadataRoute } from 'next';
import { prisma } from '@/lib/db';
import { productUrl } from '@/lib/seo/catalog';

/** every active product page, for Google and Bing (submit «/sitemap.xml» in Google Search Console once) */
export const dynamic = 'force-dynamic';
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const products = await prisma.product.findMany({ where: { active: true }, select: { slug: true, updatedAt: true }, orderBy: { updatedAt: 'desc' }, take: 45000 });
  return products.map((p) => ({ url: productUrl(p.slug), lastModified: p.updatedAt, changeFrequency: 'weekly', priority: 0.8 }));
}
