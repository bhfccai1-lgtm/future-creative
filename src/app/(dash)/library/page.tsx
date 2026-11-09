import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/server';
import { PageHeader, Empty } from '@/components/ui';
import { StateBadge } from '@/components/state-badge';

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ account?: string; page?: string }> }) {
  await requirePageUser();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const where = { media: { some: { role: 'FINAL' } }, ...(sp.account ? { accountId: sp.account } : {}) };
  const [ads, total, accounts] = await Promise.all([
    prisma.advertisement.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * 24, take: 24, include: { media: { where: { role: { in: ['FINAL', 'VIDEO'] } } }, account: true } }),
    prisma.advertisement.count({ where }),
    prisma.socialAccount.findMany({ select: { id: true, name: true }, orderBy: { createdAt: 'asc' } }),
  ]);
  return (
    <>
      <PageHeader title="مكتبة التصاميم" subtitle={`${total} تصميم منجز`} />
      <form className="mb-4 flex gap-2">
        <select name="account" defaultValue={sp.account ?? ''} className="input w-64"><option value="">كل الحسابات</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <button className="rounded-lg bg-navy-800 px-4 text-sm font-bold text-white">تصفية</button>
      </form>
      {!ads.length && <Empty>لا توجد تصاميم بعد.</Empty>}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6">
        {ads.map((ad) => {
          const img = ad.media.find((m) => m.role === 'FINAL');
          return (
            <Link key={ad.id} href={`/ads/${ad.id}`} className="group card overflow-hidden">
              <div className="relative">
                <img loading="lazy" className="aspect-[9/16] w-full object-cover transition group-hover:scale-105" src={`/api/media/${img!.storageKey}`} alt={ad.headline ?? ''} />
                {ad.media.some((m) => m.role === 'VIDEO') && <span className="absolute left-2 top-2 rounded bg-black/70 px-2 text-xs text-white">▶ Reel</span>}
              </div>
              <div className="p-2"><div className="truncate text-xs font-bold">{ad.headline}</div><div className="truncate text-[11px] text-slate-500">{ad.account.name}</div><StateBadge state={ad.state} /></div>
            </Link>
          );
        })}
      </div>
      <div className="mt-6 flex gap-3 text-sm">
        {page > 1 && <Link className="underline" href={`?page=${page - 1}${sp.account ? `&account=${sp.account}` : ''}`}>السابق</Link>}
        {page * 24 < total && <Link className="underline" href={`?page=${page + 1}${sp.account ? `&account=${sp.account}` : ''}`}>التالي</Link>}
      </div>
    </>
  );
}
