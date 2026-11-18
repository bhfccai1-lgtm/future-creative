import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/server';
import { getSettings } from '@/lib/settings';
import { getBusiness, locationsOf } from '@/lib/business';
import { PrintStudio } from '@/components/print-studio';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'PRINT DESIGN STUDIO V6.0' };

/** PRINT DESIGN STUDIO — every print product, from request to production file (client products stay separate from the printer's own ads). */
export default async function PrintStudioPage() {
  const user = await requirePageUser('ads:create');
  const [rows, s, accounts, biz, logo] = await Promise.all([
    prisma.printProject.findMany({ where: user.perms.includes('users:manage') ? {} : { createdBy: user.email }, orderBy: { updatedAt: 'desc' }, take: 100, select: { id: true, title: true, productId: true, status: true, updatedAt: true, mockupKey: true } }),
    getSettings(),
    prisma.socialAccount.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    getBusiness().catch(() => null),
    prisma.brandAsset.findFirst({ where: { kind: 'LOGO_PRIMARY', approved: true, active: true }, select: { id: true } }).catch(() => null),
  ]);
  const shop = { logo: !!logo, phones: biz ? locationsOf(biz).map((l) => ({ name: l.nameAr, phone: l.phone })) : [] };
  return <PrintStudio initial={JSON.parse(JSON.stringify(rows))} accounts={accounts} caps={s.print} canAdmin={user.perms.includes('settings:ai')} shop={shop} />;
}
