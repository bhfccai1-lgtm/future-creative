import type { Business, Product, ProductCategory } from '@prisma/client';
import { prisma } from '../db';
import { env } from '../env';
import { locationsOf } from '../business';

/**
 * «الظهور في Google» — the public product pages (/p/<slug>) are the shop's catalogue on the web.
 * This module gives Google what it needs to rank them for local searches («طباعة أكواب البحرين»):
 * a clear title and description with the place, a canonical URL, a stable image URL, structured data
 * (schema.org Product + the local business with its branches) and a health report for the owner.
 */
export const siteUrl = () => env().PUBLIC_BASE_URL.replace(/\/+$/, '');
export const productUrl = (slug: string) => `${siteUrl()}/p/${encodeURIComponent(slug)}`;
/** a permanent image URL (the signed media links expire — bad for Google Images and link previews) */
export const productImageUrl = (slug: string) => `${productUrl(slug)}/image`;

const clip = (t: string, n: number) => (t.length <= n ? t : `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…`);
const COUNTRY_AR = 'البحرين';

type P = Pick<Product, 'slug' | 'titleAr' | 'titleEn' | 'catalogDescription' | 'priceFrom' | 'recommendedMessages'> & { category?: Pick<ProductCategory, 'nameAr'> | null };

/** «طباعة الأكواب في البحرين | مطبعة إبداع المستقبل» — the place is part of what people type */
export function seoTitle(p: P, b: Pick<Business, 'nameAr'>) {
  const name = p.titleAr.includes(COUNTRY_AR) ? p.titleAr : `${p.titleAr} في ${COUNTRY_AR}`;
  return clip(`${name} | ${b.nameAr}`, 70);
}

/** ~155 characters: what it is, where, and how to order (the snippet Google shows under the title) */
export function seoDescription(p: P, b: Business) {
  const m = (p.recommendedMessages ?? {}) as { ar?: string[] };
  const base = p.catalogDescription?.trim() || (m.ar ?? []).slice(0, 2).join('، ') || `${p.titleAr} بجودة عالية وتصميم حسب طلبك`;
  const branches = locationsOf(b).map((l) => l.nameAr).join(' و');
  return clip(`${base.replace(/\s+/g, ' ')} — ${b.nameAr}${branches ? `، فروع ${branches}` : ''}، ${COUNTRY_AR}. اطلب عبر واتساب.`, 160);
}

/** schema.org Product (+ offer from the starting price) sold by the local business with its branches */
export function productJsonLd(p: P, b: Business, o: { hasImage?: boolean } = {}) {
  const branches = locationsOf(b);
  const seller = {
    '@type': 'LocalBusiness', name: b.nameAr, alternateName: b.nameEn, url: siteUrl(),
    address: { '@type': 'PostalAddress', addressCountry: 'BH', ...(branches.length ? { addressLocality: branches.map((l) => l.nameEn).join(', ') } : {}) },
    ...(branches[0]?.phone ? { telephone: `+973${branches[0].phone}` } : {}),
    ...(branches.length > 1 ? { department: branches.map((l) => ({ '@type': 'LocalBusiness', name: `${b.nameAr} — ${l.nameAr}`, telephone: `+973${l.phone}`, address: { '@type': 'PostalAddress', addressLocality: l.nameEn, addressCountry: 'BH' } })) } : {}),
  };
  return {
    '@context': 'https://schema.org', '@type': 'Product', name: p.titleAr, alternateName: p.titleEn,
    description: seoDescription(p, b), ...(o.hasImage ? { image: productImageUrl(p.slug) } : {}), url: productUrl(p.slug),
    ...(p.category?.nameAr ? { category: p.category.nameAr } : {}),
    brand: { '@type': 'Brand', name: b.nameAr },
    ...(p.priceFrom != null ? { offers: { '@type': 'Offer', price: p.priceFrom.toFixed(b.currency === 'BHD' ? 3 : 2), priceCurrency: b.currency, availability: 'https://schema.org/InStock', areaServed: 'BH', url: productUrl(p.slug), seller } } : { manufacturer: seller }),
  };
}

/** related products in the same category — internal links help Google find (and rank) the whole catalogue */
export async function relatedProducts(productId: string, categoryId: string, take = 6) {
  return prisma.product.findMany({ where: { active: true, categoryId, id: { not: productId } }, select: { slug: true, titleAr: true }, orderBy: { updatedAt: 'desc' }, take });
}

export interface SeoHealth { total: number; withDescription: number; withPrice: number; withImage: number; missingDescription: { slug: string; titleAr: string }[]; sitemap: string }
/** what to fix first: products without a description (thin pages rank poorly), a price, or a picture */
export async function seoHealth(): Promise<SeoHealth> {
  const products = await prisma.product.findMany({ where: { active: true }, select: { id: true, slug: true, titleAr: true, catalogDescription: true, priceFrom: true }, take: 5000 });
  const { productImages } = await import('../integrations/whatsapp-catalog');
  const images = await productImages(products.map((p) => p.id));
  const thin = products.filter((p) => (p.catalogDescription?.trim().length ?? 0) < 60);
  return {
    total: products.length, withDescription: products.length - thin.length, withPrice: products.filter((p) => p.priceFrom != null).length,
    withImage: products.filter((p) => images.has(p.id)).length, missingDescription: thin.slice(0, 8).map((p) => ({ slug: p.slug, titleAr: p.titleAr })), sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
