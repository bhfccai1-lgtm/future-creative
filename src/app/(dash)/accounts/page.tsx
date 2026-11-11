import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/server';
import { Card, PageHeader, Badge } from '@/components/ui';
import { ConnBadge, PLATFORM_AR, LANG_AR, FORMAT_AR } from '@/components/state-badge';
import { AccountForm } from '@/components/account-form';
import { fmtLocal } from '@/lib/time';

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
      <Card className="mb-6 overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead><tr><th className="th">الحساب</th><th className="th">المنصة</th><th className="th">اللغة</th><th className="th">الصيغة</th><th className="th">الربط</th><th className="th">النشر الآلي</th><th className="th">التفويض الذاتي</th><th className="th">النشر التالي</th><th className="th">الإعلانات</th></tr></thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} className="border-t hover:bg-slate-50">
                <td className="td"><Link href={`/accounts/${a.id}`} className="font-bold text-navy-700 hover:underline">{a.name}</Link>{a.handle && <div className="text-xs text-slate-500 ltr">@{a.handle}</div>}</td>
                <td className="td">{PLATFORM_AR[a.platform]}</td><td className="td">{LANG_AR[a.language]}</td><td className="td text-xs">{FORMAT_AR[a.publishFormat]}</td>
                <td className="td"><ConnBadge status={a.connection?.status} /></td>
                <td className="td">{a.paused ? <Badge tone="red">⏸ موقوف طارئًا</Badge> : <Badge tone={a.autoPublishEnabled ? 'green' : 'slate'}>{a.autoPublishEnabled ? 'مفعّل' : 'متوقف'}</Badge>}<div className="text-[10px] text-slate-500">كل {Math.round(a.publishIntervalMinutes / 60 * 10) / 10} س</div></td>
                <td className="td"><Badge tone={a.autonomousAuthorized ? 'red' : 'slate'}>{a.autonomousAuthorized ? 'مفوّض' : 'غير مفوّض'}</Badge></td>
                <td className="td text-xs">{fmtLocal(a.nextPublishAt)}</td><td className="td">{a._count.advertisements}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="إضافة حساب جديد"><AccountForm categories={cats.map((c) => ({ id: c.id, nameAr: c.nameAr, count: c._count.products }))} products={products} /></Card>
    </>
  );
}
