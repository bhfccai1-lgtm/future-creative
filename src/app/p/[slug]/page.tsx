import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getBusiness, locationsOf } from '@/lib/business';
import { productImages } from '@/lib/integrations/whatsapp-catalog';
import { signedMediaUrl } from '@/lib/storage';

/** Public product page — the «link» of each WhatsApp/Meta catalogue item. Shows only customer-facing fields. */
export const dynamic = 'force-dynamic';

async function load(slug: string) {
  const p = await prisma.product.findUnique({ where: { slug }, include: { category: true } });
  if (!p || !p.active) return null;
  const key = (await productImages([p.id])).get(p.id);
  return { p, image: key ? signedMediaUrl(key, 7 * 24 * 3600) : null };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const d = await load((await params).slug);
  if (!d) return { title: 'غير متوفر' };
  const b = await getBusiness();
  return { title: `${d.p.titleAr} — ${b.nameAr}`, description: d.p.catalogDescription ?? d.p.titleEn, openGraph: d.image ? { images: [d.image] } : undefined };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const d = await load((await params).slug);
  if (!d) notFound();
  const { p, image } = d;
  const b = await getBusiness();
  const m = (p.recommendedMessages ?? {}) as { ar?: string[] };
  const desc = p.catalogDescription?.trim() || (m.ar ?? []).slice(0, 2).join(' · ');
  const digits = b.currency === 'BHD' ? 3 : 2;
  return (
    <main className="mx-auto min-h-screen max-w-xl bg-white px-4 py-6 text-navy-900">
      <p className="text-sm font-bold text-navy-700">{b.nameAr}</p>
      <h1 className="mt-1 text-2xl font-extrabold">{p.titleAr}</h1>
      <p className="text-sm text-gray-500" dir="ltr">{p.titleEn}</p>
      {image && (
        <img src={image} alt={p.titleAr} className="mt-4 w-full rounded-2xl border border-gray-200" />
      )}
      {desc && <p className="mt-4 whitespace-pre-line leading-7">{desc}</p>}
      {p.priceFrom != null && <p className="mt-3 text-lg font-bold">يبدأ من {p.priceFrom.toFixed(digits)} {b.currency === 'BHD' ? 'د.ب' : b.currency}</p>}
      <div className="mt-6 space-y-3">
        {locationsOf(b).map((l) => (
          <a key={l.key} className="block rounded-xl bg-green-600 px-4 py-3 text-center font-bold text-white"
            href={`https://wa.me/973${l.phone}?text=${encodeURIComponent(`مرحبا، أرغب بالاستفسار عن: ${p.titleAr}`)}`} target="_blank" rel="noopener noreferrer">
            اطلب عبر واتساب — فرع {l.nameAr} ({l.phone})
          </a>
        ))}
      </div>
    </main>
  );
}
