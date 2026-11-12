import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/server';
import { Card, PageHeader, Badge } from '@/components/ui';
import { ConnBadge, LANG_AR, FORMAT_AR } from '@/components/state-badge';
import { AccountForm } from '@/components/account-form';
import { fmtLocal } from '@/lib/time';
import { ActionButton } from '@/components/action-button';

const NET_AR: Record<string, string> = { instagram: 'إنستغرام', gmb: 'Google التجاري', tiktok: 'تيك توك', facebook: 'فيسبوك', youtube: 'يوتيوب', threads: 'ثريدز', linkedin: 'لينكدإن', twitter: 'X', pinterest: 'بنترست' };

export default async function AccountsPage() {
  await requirePageUser();
  const [accounts, products, cats] = await Promise.all([
    prisma.socialAccount.findMany({ include: { connection: true, _count: { select: { advertisements: true } } }, orderBy: { createdAt: 'asc' } }),
    prisma.product.findMany({ where: { active: true }, select: { id: true, titleAr: true, categoryId: true }, orderBy: { titleAr: 'asc' } }),
    prisma.productCategory.findMany({ orderBy: { nameAr: 'asc' }, select: { id: true, nameAr: true, _count: { select: { products: { where: { active: true } } } } } }),
  ]);
  return (
    <>
      <PageHeader title="الحسابات الاجتماعية" subtitle={`${accounts.length} حساب — كل حساب له إعداداته وسجله المستقل`} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ActionButton url="/api/accounts/verify-all" method="POST" label="فحص كل الحسابات الآن" variant="outline" size="sm" />
        <span className="text-xs text-slate-500">يقرأ من Metricool الشبكات المربوطة بكل علامة (إنستغرام، Google التجاري، تيك توك…)</span>
      </div>
      <div className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {accounts.map((a) => {
          const nets = ((a.connection?.providerSnapshot as { networks?: { network: string }[] } | null)?.networks ?? []).map((n) => n.network);
          return (
            <Link key={a.id} href={`/accounts/${a.id}`} className="block rounded-xl border bg-white p-3 hover:shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div><div className="font-extrabold text-navy-800">{a.name}</div>{a.handle && <div className="ltr text-xs text-slate-500">@{a.handle}</div>}</div>
                <ConnBadge status={a.connection?.status} />
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {nets.length ? nets.map((n) => <Badge key={n} tone={n === 'gmb' ? 'green' : 'blue'}>{NET_AR[n] ?? n}</Badge>) : <span className="text-xs text-slate-400">لا توجد شبكات — اضغط «فحص كل الحسابات»</span>}
                {nets.includes('gmb') && <Badge tone={a.gbpAuto ? 'gold' : 'slate'}>{a.gbpAuto ? `Google تلقائي ${a.gbpPerWeek}/أسبوع` : 'Google: النشر التلقائي غير مفعّل'}</Badge>}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <div><span className="text-slate-500">الصيغة: </span>{a.formatStrategy === 'GROWTH_MIX' ? 'تنويع ذكي' : FORMAT_AR[a.publishFormat]}</div>
                <div><span className="text-slate-500">اللغة: </span>{LANG_AR[a.language]}</div>
                <div><span className="text-slate-500">النشر الآلي: </span>{a.paused ? '⏸ موقوف طارئًا' : a.autoPublishEnabled ? `مفعّل · كل ${Math.round(a.publishIntervalMinutes / 60 * 10) / 10} س` : 'متوقف'}</div>
                <div><span className="text-slate-500">التفويض: </span>{a.autonomousAuthorized ? 'نشر بدون موافقة' : 'بموافقتك'}</div>
                <div><span className="text-slate-500">النافذة: </span><span className="ltr">{a.publishWindowStart}–{a.publishWindowEnd}</span></div>
                <div><span className="text-slate-500">التالي: </span>{fmtLocal(a.nextPublishAt)}</div>
                <div><span className="text-slate-500">الفئات: </span>{a.allowedCategoryIds.length ? `${a.allowedCategoryIds.length} فئة` : 'كل المنتجات'}</div>
                <div><span className="text-slate-500">التصاميم: </span>{a._count.advertisements}</div>
              </div>
            </Link>
          );
        })}
      </div>
      <Card title="إضافة حساب جديد"><AccountForm categories={cats.map((c) => ({ id: c.id, nameAr: c.nameAr, count: c._count.products }))} products={products} /></Card>
    </>
  );
}
