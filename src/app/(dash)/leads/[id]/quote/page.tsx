import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/server';
import { Card, PageHeader } from '@/components/ui';
import { QuoteForm } from '@/components/quote-form';
import type { Quote } from '@/lib/leads/scripts';
export const dynamic = 'force-dynamic';

export default async function QuoteEditPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageUser('ads:approve');
  const { id } = await params;
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id }, include: { product: { select: { titleAr: true } } } });
  const q = lead.quote as unknown as Quote | null;
  const products = await prisma.product.findMany({ where: { active: true }, select: { titleAr: true }, orderBy: { titleAr: 'asc' }, take: 300 });
  const suggestions = [...new Set([lead.product?.titleAr, ...products.map((p) => p.titleAr)].filter((x): x is string => !!x))];
  return (
    <>
      <PageHeader title={q ? `تعديل عرض السعر رقم ${q.no}` : 'عرض سعر جديد'} subtitle={`${lead.name ?? lead.contact ?? 'عميل'} — ${lead.need}`} actions={q ? <Link href={`/q/${id}`} className="text-sm font-bold text-gold-600 underline">عرض النسخة الحالية ←</Link> : undefined} />
      <Card><QuoteForm leadId={id} initial={q ? { items: q.items, discount: q.discount, notes: q.notes } : null} suggestions={suggestions} /></Card>
      <p className="mt-3 text-xs text-slate-500">الأسعار تكتبها أنت — النظام لا يقترح أسعارًا. بعد الحفظ تظهر نسخة بهويتك للطباعة أو الحفظ PDF، وزر إرسالها عبر واتساب.</p>
    </>
  );
}
