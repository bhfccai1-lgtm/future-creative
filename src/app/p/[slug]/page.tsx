import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getBusiness } from '@/lib/business';
import { displayWaPhone, waLink, waNumbers } from '@/lib/integrations/whatsapp-numbers';
import { productImages } from '@/lib/integrations/whatsapp-catalog';
import { productImageUrl, productJsonLd, productUrl, relatedProducts, seoDescription, seoTitle } from '@/lib/seo/catalog';

/** Public product page — the «link» of each WhatsApp/Meta catalogue item. Shows only customer-facing fields. */
export const dynamic = 'force-dynamic';

async function load(slug: string) {
  const p = await prisma.product.findUnique({ where: { slug }, include: { category: true } });
  if (!p || !p.active) return null;
  const key = (await productImages([p.id])).get(p.id);
  return { p, image: key ? productImageUrl(p.slug) : null };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const d = await load((await params).slug);
  if (!d) return { title: 'غير متوفر' };
  const b = await getBusiness();
  const title = seoTitle(d.p, b), description = seoDescription(d.p, b), url = productUrl(d.p.slug);
  return {
    title, description, alternates: { canonical: url }, robots: { index: true, follow: true },
    openGraph: { type: 'website', locale: 'ar_BH', siteName: b.nameAr, title, description, url, ...(d.image ? { images: [{ url: d.image, alt: d.p.titleAr }] } : {}) },
    twitter: { card: d.image ? 'summary_large_image' : 'summary', title, description, ...(d.image ? { images: [d.image] } : {}) },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const d = await load((await params).slug);
  if (!d) notFound();
  const { p, image } = d;
  const b = await getBusiness();
  const m = (p.recommendedMessages ?? {}) as { ar?: string[] };
  const desc = p.catalogDescription?.trim() || (m.ar ?? []).slice(0, 2).join(' · ');
  const digits = b.currency === 'BHD' ? 3 : 2;
  const related = await relatedProducts(p.id, p.categoryId);
  // structured data: «<» is escaped so a product text can never close the script tag
  const ld = JSON.stringify(productJsonLd(p, b, { hasImage: !!image })).replace(/</g, '\\u003c');
  return (
    <main className="mx-auto min-h-screen max-w-xl bg-white px-4 py-6 text-navy-900">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld }} />
      <p className="text-sm font-bold text-navy-700">{b.nameAr}</p>
      <h1 className="mt-1 text-2xl font-extrabold">{p.titleAr}</h1>
      <p className="text-sm text-gray-500" dir="ltr">{p.titleEn}</p>
      {image && (
        <img src={image} alt={p.titleAr} className="mt-4 w-full rounded-2xl border border-gray-200" />
      )}
      {desc && <p className="mt-4 whitespace-pre-line leading-7">{desc}</p>}
      {p.priceFrom != null && <p className="mt-3 text-lg font-bold">يبدأ من {p.priceFrom.toFixed(digits)} {b.currency === 'BHD' ? 'د.ب' : b.currency}</p>}
      <div className="mt-6 space-y-3">
        {(await waNumbers()).filter((n) => n.showOnProductPage).map((n) => (
          <a key={n.phone} className="block rounded-xl bg-green-600 px-4 py-3 text-center font-bold text-white"
            href={waLink(n.phone, `مرحبا، أرغب بالاستفسار عن: ${p.titleAr}`)} target="_blank" rel="noopener noreferrer">
            اطلب عبر واتساب — {n.label} <span dir="ltr">({displayWaPhone(n.phone)})</span>
          </a>
        ))}
      </div>
      {related.length > 0 && (
        <nav className="mt-8 border-t pt-4" aria-label="منتجات مشابهة">
          <h2 className="mb-2 text-sm font-bold text-navy-700">منتجات مشابهة من {p.category.nameAr}</h2>
          <ul className="flex flex-wrap gap-2 text-sm">{related.map((r) => <li key={r.slug}><a href={`/p/${encodeURIComponent(r.slug)}`} className="block rounded-full border px-3 py-1 hover:bg-gray-50">{r.titleAr}</a></li>)}</ul>
        </nav>
      )}
      <p className="mt-6 text-center text-xs text-gray-400">{b.nameAr} — {b.nameEn} · البحرين</p>
    </main>
  );
}
