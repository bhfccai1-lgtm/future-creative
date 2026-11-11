import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/server';
import { Card, PageHeader } from '@/components/ui';
import { ProductForm } from '@/components/product-form';
import { ProductImport, ProductTable } from '@/components/product-catalog';
export const dynamic = 'force-dynamic';

const PER = 50;
export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; cat?: string; status?: string; page?: string }> }) {
  await requirePageUser();
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.ProductWhereInput = {
    ...(q ? { OR: [{ titleAr: { contains: q, mode: 'insensitive' } }, { titleEn: { contains: q, mode: 'insensitive' } }, { slug: { contains: q.toLowerCase() } }] } : {}),
    ...(sp.cat ? { categoryId: sp.cat } : {}),
    ...(sp.status === 'active' ? { active: true } : sp.status === 'inactive' ? { active: false } : {}),
  };
  const [total, totalAll, activeAll, products, categories] = await Promise.all([
    prisma.product.count({ where }), prisma.product.count(), prisma.product.count({ where: { active: true } }),
    prisma.product.findMany({ where, include: { category: true, _count: { select: { advertisements: true } } }, orderBy: [{ category: { nameAr: 'asc' } }, { titleAr: 'asc' }], skip: (page - 1) * PER, take: PER }),
    prisma.productCategory.findMany({ orderBy: { nameAr: 'asc' }, include: { _count: { select: { products: true } } } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PER));
  const link = (p: number) => `/products?${new URLSearchParams({ ...(q ? { q } : {}), ...(sp.cat ? { cat: sp.cat } : {}), ...(sp.status ? { status: sp.status } : {}), page: String(p) })}`;
  return (
    <>
      <PageHeader title="المنتجات والخدمات" subtitle={`${totalAll} منتج/خدمة — ${activeAll} نشط · ${categories.length} فئة`} />
      <Card title="استيراد جماعي (Excel / Google Sheets)" className="mb-6"><ProductImport /></Card>
      <Card className="mb-6">
        <form className="mb-3 flex flex-wrap gap-2">
          <input name="q" defaultValue={q} className="input" style={{ width: '16rem' }} placeholder="بحث بالاسم…" />
          <select name="cat" defaultValue={sp.cat ?? ''} className="input" style={{ width: '14rem' }}><option value="">كل الفئات</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.nameAr} ({c._count.products})</option>)}</select>
          <select name="status" defaultValue={sp.status ?? ''} className="input" style={{ width: '9rem' }}><option value="">الكل</option><option value="active">نشط</option><option value="inactive">متوقف</option></select>
          <button className="rounded-lg bg-navy-800 px-4 text-sm font-bold text-white">بحث</button>
        </form>
        <p className="mb-2 text-xs text-slate-500">{total} نتيجة · صفحة {page} من {pages}</p>
        <ProductTable rows={products.map((p) => ({ id: p.id, titleAr: p.titleAr, titleEn: p.titleEn, category: p.category.nameAr, active: p.active, ads: p._count.advertisements, perf: p.performanceScore }))} />
        {pages > 1 && <div className="mt-3 flex flex-wrap gap-1 text-sm">{page > 1 && <Link className="rounded border px-3 py-1" href={link(page - 1)}>السابق</Link>}{Array.from({ length: Math.min(pages, 10) }, (_, i) => { const n = pages <= 10 ? i + 1 : Math.min(pages, Math.max(1, page - 4) + i); return <Link key={n} className={`rounded border px-3 py-1 ${n === page ? 'bg-navy-800 text-white' : ''}`} href={link(n)}>{n}</Link>; })}{page < pages && <Link className="rounded border px-3 py-1" href={link(page + 1)}>التالي</Link>}</div>}
      </Card>
      <Card title="إضافة منتج أو خدمة واحدة"><ProductForm categories={categories} /></Card>
    </>
  );
}
