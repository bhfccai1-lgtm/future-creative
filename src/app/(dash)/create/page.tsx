import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/server';
import { getSettings } from '@/lib/settings';
import { Card, PageHeader } from '@/components/ui';
import { GenerateForm } from '@/components/generate-form';
import { PLATFORM_AR, LANG_AR } from '@/components/state-badge';
import { estimateAdCost } from '@/lib/ai/cost';

export default async function CreatePage({ searchParams }: { searchParams: Promise<{ idea?: string }> }) {
  await requirePageUser('ads:create');
  const initialIdea = ((await searchParams).idea ?? '').slice(0, 500);
  const [accounts, products, s, logo] = await Promise.all([
    prisma.socialAccount.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.product.findMany({ where: { active: true }, orderBy: { titleAr: 'asc' } }),
    getSettings(),
    prisma.brandAsset.findFirst({ where: { kind: 'LOGO_PRIMARY', active: true, approved: true } }),
  ]);
  return (
    <>
      <PageHeader title="إنشاء تصميم جديد" subtitle="يرسم الذكاء الاصطناعي الملصق كاملًا (العناوين، الشارة الذهبية، المزايا، الزخارف، المنتج) ويُدقَّق نصه آليًا، ثم يضيف النظام الشعار الأصلي وزر الطلب وأرقام الفرعين." />
      {!logo && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">لا يوجد شعار رسمي معتمد — التوليد محظور حتى رفع الشعار الأصلي واعتماده من «إعدادات الهوية».</div>}
      {s.ai.dryRun && <div className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">وضع التجربة مفعّل: يُنشأ مشهد إجرائي محلي دون استدعاء OpenAI ودون تكلفة. هذه المعاينات <b>غير قابلة للنشر</b>.</div>}
      <p className="mb-4 text-sm text-slate-600">تريد تكرار الإعلان بتصميم جديد كل عدة ساعات أو في تاريخ ووقت محدد؟ استخدم <Link className="font-bold text-navy-700 underline" href="/campaigns">الحملات المتكررة</Link>.</p>
      <Card title="طلب إعلان" actions={<span className="text-xs text-slate-500">التكلفة التقديرية: <span className="ltr">${s.ai.dryRun ? '0.000' : estimateAdCost(s).toFixed(3)}</span></span>}>
        <GenerateForm accounts={accounts.map((a) => ({ id: a.id, label: `${a.name} — ${PLATFORM_AR[a.platform]} — ${LANG_AR[a.language]}` }))} products={products.map((p) => ({ id: p.id, label: p.titleAr }))} initialIdea={initialIdea} />
      </Card>
    </>
  );
}
