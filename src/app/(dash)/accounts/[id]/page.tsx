import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/server';
import { Card, PageHeader, Badge } from '@/components/ui';
import { ConnBadge, StateBadge, PLATFORM_AR } from '@/components/state-badge';
import { AccountForm } from '@/components/account-form';
import { ConnectPanel } from '@/components/connect-panel';
import { ActionButton } from '@/components/action-button';
import { fmtLocal } from '@/lib/time';

export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageUser();
  const { id } = await params;
  const a = await prisma.socialAccount.findUnique({ where: { id }, include: { connection: true } });
  if (!a) notFound();
  const [products, cats, ads, jobs, errors] = await Promise.all([
    prisma.product.findMany({ where: { active: true }, select: { id: true, titleAr: true, categoryId: true }, orderBy: { titleAr: 'asc' } }),
    prisma.productCategory.findMany({ orderBy: { nameAr: 'asc' }, select: { id: true, nameAr: true, _count: { select: { products: { where: { active: true } } } } } }),
    prisma.advertisement.findMany({ where: { accountId: id }, orderBy: { createdAt: 'desc' }, take: 30, include: { product: true } }),
    prisma.publicationJob.findMany({ where: { accountId: id }, orderBy: { createdAt: 'desc' }, take: 30, include: { result: true } }),
    prisma.notification.findMany({ where: { accountId: id }, orderBy: { createdAt: 'desc' }, take: 20 }),
  ]);
  const c = a.connection;
  const connected = c?.status === 'CONNECTED' && c.canPublish;
  return (
    <>
      <PageHeader title={a.name} subtitle={`${PLATFORM_AR[a.platform]} · ${a.handle ? '@' + a.handle : 'بدون معرّف'}`}
        actions={<>
          <ConnBadge status={c?.status} />
          {a.paused
            ? <><Badge tone="red">⏸ موقوف{a.pausedReason ? `: ${a.pausedReason}` : ''}</Badge><ActionButton url={`/api/accounts/${id}/pause`} body={{ paused: false }} label="استئناف الحساب" variant="success" /></>
            : <ActionButton url={`/api/accounts/${id}/pause`} body={{ paused: true }} label="⏸ إيقاف طارئ لهذا الحساب" variant="danger" prompt="سبب الإيقاف (اختياري):" promptKey="reason" />}
          {a.autoPublishEnabled
            ? <ActionButton url={`/api/accounts/${id}`} method="PATCH" body={{ autoPublishEnabled: false }} label="إيقاف النشر الآلي لهذا الحساب" variant="outline" />
            : <ActionButton url={`/api/accounts/${id}`} method="PATCH" body={{ autoPublishEnabled: true }} label="السماح بالنشر الآلي لهذا الحساب" variant="success" />}
        </>} />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card collapsible title="الربط مع مزود النشر" className="xl:col-span-2">
          <dl className="mb-4 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
            <div><dt className="text-slate-500">المزود</dt><dd className="font-bold">{c?.provider ?? '—'}</dd></div>
            <div><dt className="text-slate-500">Brand ID</dt><dd className="font-bold ltr">{c?.providerBrandId ?? '—'}</dd></div>
            <div><dt className="text-slate-500">صلاحية النشر</dt><dd>{c?.canPublish ? <Badge tone="green">مؤكدة</Badge> : <Badge>غير متاحة</Badge>}</dd></div>
            <div><dt className="text-slate-500">آخر تحقق</dt><dd>{fmtLocal(c?.lastVerifiedAt)}</dd></div>
          </dl>
          {c?.lastError && <p className="mb-3 rounded bg-red-50 p-2 text-sm text-red-700">{c.lastError}</p>}
          <ConnectPanel accountId={id} platform={a.platform} currentBrandId={c?.providerBrandId} />
          {c && c.status !== 'DISCONNECTED' && <div className="mt-4"><ActionButton url={`/api/accounts/${id}/disconnect`} label="فصل هذا الحساب" variant="danger" size="sm" confirm="سيتم فصل هذا الحساب وإلغاء مهامه غير المرسلة فقط. متابعة؟" /></div>}
        </Card>
        <Card collapsible title="النشر الذاتي (Autonomous)">
          <p className="mb-3 text-sm text-slate-600">يتطلب: ربط مؤكد + تفويض هذا الحساب + تفعيل الوضع الذاتي عامًا. بدون ذلك تذهب كل التصاميم إلى طابور الموافقات.</p>
          {a.autonomousAuthorized
            ? <><Badge tone="red">مفوّض منذ {fmtLocal(a.autonomousAuthorizedAt)} بواسطة {a.autonomousAuthorizedBy}</Badge><div className="mt-3"><ActionButton url={`/api/accounts/${id}/autonomy`} body={{ authorized: false }} label="سحب التفويض" variant="outline" /></div></>
            : <ActionButton url={`/api/accounts/${id}/autonomy`} body={{ authorized: true }} label="تفويض النشر الذاتي لهذا الحساب" variant="danger" confirm="سيُسمح للنظام بنشر الإعلانات المجتازة لفحص الجودة لهذا الحساب دون موافقة يدوية. متابعة؟" />}
          {!connected && <p className="mt-2 text-xs text-amber-700">الحساب غير مرتبط — لا يمكن التفويض.</p>}
        </Card>
      </div>
      <Card collapsible title="إعدادات الحساب" className="mt-6"><AccountForm categories={cats.map((c) => ({ id: c.id, nameAr: c.nameAr, count: c._count.products }))} products={products} account={{ ...a }} linked={((a.connection?.providerSnapshot as { networks?: { network: string }[] } | null)?.networks ?? []).map((n) => n.network)} /></Card>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card collapsible title="سجل المحتوى">
          <table className="w-full"><tbody>{ads.map((ad) => <tr key={ad.id} className="border-t"><td className="td"><Link className="text-navy-700 hover:underline" href={`/ads/${ad.id}`}>{ad.headline ?? ad.product.titleAr}</Link><div className="text-xs text-slate-500">{fmtLocal(ad.createdAt)}</div></td><td className="td"><StateBadge state={ad.state} /></td></tr>)}</tbody></table>
          {!ads.length && <p className="text-sm text-slate-500">لا يوجد محتوى بعد.</p>}
        </Card>
        <Card collapsible title="نتائج النشر والأخطاء">
          <table className="w-full"><tbody>{jobs.map((j) => <tr key={j.id} className="border-t"><td className="td text-xs">{fmtLocal(j.scheduledFor)}</td><td className="td"><StateBadge state={j.state} /></td><td className="td text-xs">{j.result?.publicUrl ? <a className="text-navy-700 underline" href={j.result.publicUrl} target="_blank" rel="noreferrer">رابط المنشور</a> : j.lastError ?? ''}</td></tr>)}</tbody></table>
          {errors.map((n) => <p key={n.id} className="mt-2 rounded bg-slate-50 p-2 text-xs"><b>{n.title}</b> — {n.message}</p>)}
        </Card>
      </div>
    </>
  );
}
