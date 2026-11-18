import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/server';
import { Card, PageHeader } from '@/components/ui';
import { StateBadge } from '@/components/state-badge';
import { PortfolioForm } from '@/components/portfolio-form';
export const dynamic = 'force-dynamic';

export default async function PortfolioPage() {
  await requirePageUser('ads:create');
  const [accounts, products, recent] = await Promise.all([
    prisma.socialAccount.findMany({ select: { id: true, name: true }, orderBy: { createdAt: 'asc' } }),
    prisma.product.findMany({ where: { active: true }, select: { id: true, titleAr: true }, orderBy: { titleAr: 'asc' }, take: 300 }),
    prisma.advertisement.findMany({ where: { options: { path: ['direction', 'contentType'], equals: 'real_work' } }, orderBy: { createdAt: 'desc' }, take: 12, include: { media: { where: { role: 'FINAL' } }, account: { select: { name: true } } } }),
  ]);
  return (
    <>
      <PageHeader title="أعمال منجزة" subtitle="أقوى محتوى لمطبعة: صور حقيقية لأعمالك. ارفع صورة عمل سلّمته، ويحوّلها النظام إلى منشور بهويتك (الشعار، اطلب الآن، رقمي الفرعين) مع نص احترافي — بدون رسم بالذكاء الاصطناعي، فالصورة تبقى حقيقية." />
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card title="منشور جديد من صورة حقيقية"><PortfolioForm accounts={accounts} products={products.map((p) => ({ id: p.id, name: p.titleAr }))} /></Card>
        <Card title="لماذا «أعمال منجزة»؟">
          <ul className="space-y-2 text-sm leading-7 text-slate-700">
            <li>✅ <b>الثقة تبيع:</b> العميل يرى عملًا حقيقيًا سُلّم لغيره، لا صورة مولّدة.</li>
            <li>✅ <b>أرخص:</b> لا تُرسم صورة بالذكاء الاصطناعي — يُكتب النص فقط.</li>
            <li>✅ <b>نص مدقق 100%:</b> العنوان والأرقام والشعار طبقات يضيفها النظام.</li>
            <li>💡 صوّر كل طلب قبل تسليمه: على خلفية نظيفة، إضاءة نهار، والمنتج يملأ الصورة.</li>
            <li>💡 انشر عملًا منجزًا مرتين أسبوعيًا على الأقل في كل حساب كبير.</li>
            <li>🔒 لا يُذكر اسم العميل إلا بموافقته.</li>
          </ul>
        </Card>
      </div>
      <h2 className="mb-3 mt-6 text-lg font-extrabold text-navy-900">آخر منشورات الأعمال المنجزة</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        {recent.map((ad) => (
          <Link key={ad.id} href={`/ads/${ad.id}`} className="overflow-hidden rounded-xl border bg-white">
            {ad.media[0] ? <img src={`/api/media/${ad.media[0].storageKey}`} alt={ad.headline ?? ''} className="aspect-[4/5] w-full bg-slate-100 object-cover" loading="lazy" /> : <div className="flex aspect-[4/5] items-center justify-center bg-slate-50 text-xs text-slate-400">قيد التجهيز…</div>}
            <div className="p-2"><div className="truncate text-xs font-bold">{ad.headline ?? '…'}</div><div className="flex items-center justify-between gap-1 text-[11px] text-slate-500"><span className="truncate">{ad.account.name}</span><StateBadge state={ad.state} /></div></div>
          </Link>
        ))}
        {!recent.length && <p className="col-span-full text-sm text-slate-500">لم تُنشأ منشورات أعمال منجزة بعد.</p>}
      </div>
    </>
  );
}
