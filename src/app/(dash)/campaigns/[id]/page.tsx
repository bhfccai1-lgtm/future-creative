import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/server';
import { Card, PageHeader } from '@/components/ui';
import { CampaignForm } from '@/components/campaign-form';
import { PLATFORM_AR } from '@/components/state-badge';
export const dynamic = 'force-dynamic';

export default async function EditCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageUser();
  const { id } = await params;
  const c = await prisma.campaign.findUnique({ where: { id } });
  if (!c) notFound();
  const [accounts, products, categories] = await Promise.all([
    prisma.socialAccount.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.product.findMany({ where: { active: true }, orderBy: { titleAr: 'asc' }, select: { id: true, titleAr: true, categoryId: true } }),
    prisma.productCategory.findMany({ orderBy: { nameAr: 'asc' }, select: { id: true, nameAr: true, _count: { select: { products: { where: { active: true } } } } } }),
  ]);
  return (
    <>
      <PageHeader title={`تعديل الحملة: ${c.name}`} subtitle="التعديل يُطبَّق على المواعيد القادمة فقط — التصاميم السابقة لا تتغير." actions={<Link href="/campaigns" className="text-sm text-navy-700 underline">رجوع للحملات</Link>} />
      <Card>
        <CampaignForm
          initial={{ id: c.id, name: c.name, accountIds: c.accountIds, productId: c.productId, format: c.format, language: c.language, direction: (c.direction ?? null) as Record<string, unknown> | null, scheduleType: c.scheduleType, everyHours: c.everyHours, daysOfWeek: c.daysOfWeek, timeMode: c.timeMode, startAt: c.startAt.toISOString(), endAt: c.endAt?.toISOString() ?? null, maxRuns: c.maxRuns }}
          accounts={accounts.map((a) => ({ id: a.id, label: `${a.name} — ${PLATFORM_AR[a.platform]}` }))}
          products={products.map((p) => ({ id: p.id, label: p.titleAr, categoryId: p.categoryId }))}
          categories={categories.filter((x) => x._count.products > 0).map((x) => ({ id: x.id, label: `${x.nameAr} (${x._count.products})` }))} />
      </Card>
    </>
  );
}
