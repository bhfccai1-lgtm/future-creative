import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/server';
import { Card, PageHeader, Badge } from '@/components/ui';
import { ActionButton } from '@/components/action-button';
import { ProductForm } from '@/components/product-form';

export default async function ProductsPage() {
  await requirePageUser();
  const [products, categories] = await Promise.all([
    prisma.product.findMany({ include: { category: true, _count: { select: { advertisements: true } } }, orderBy: [{ category: { nameAr: 'asc' } }, { titleAr: 'asc' }] }),
    prisma.productCategory.findMany({ orderBy: { nameAr: 'asc' } }),
  ]);
  return (
    <>
      <PageHeader title="المنتجات والخدمات" subtitle={`${products.length} منتج/خدمة — ${products.filter((p) => p.active).length} نشط`} />
      <Card className="mb-6 overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead><tr><th className="th">المنتج</th><th className="th">الفئة</th><th className="th">الجمهور</th><th className="th">المناسبات</th><th className="th">الأداء</th><th className="th">الإعلانات</th><th className="th">الحالة</th></tr></thead>
          <tbody>{products.map((p) => (
            <tr key={p.id} className="border-t">
              <td className="td"><div className="font-bold">{p.titleAr}</div><div className="text-xs text-slate-500 ltr">{p.titleEn}{p.titleMl ? ` · ${p.titleMl}` : ''}</div></td>
              <td className="td text-xs">{p.category.nameAr}</td>
              <td className="td text-xs">{p.targetAudience.join('، ')}</td>
              <td className="td text-xs">{p.occasions.join('، ')}</td>
              <td className="td text-xs">{p.performanceScore === 0 ? '—' : p.performanceScore.toFixed(2)}</td>
              <td className="td">{p._count.advertisements}</td>
              <td className="td">{p.active ? <Badge tone="green">نشط</Badge> : <Badge>متوقف</Badge>}<div className="mt-1"><ActionButton url={`/api/products/${p.id}`} method="PATCH" body={{ active: !p.active }} label={p.active ? 'إيقاف' : 'تفعيل'} variant="ghost" size="sm" /></div></td>
            </tr>
          ))}</tbody>
        </table>
      </Card>
      <Card title="إضافة منتج أو خدمة"><ProductForm categories={categories} /></Card>
    </>
  );
}
