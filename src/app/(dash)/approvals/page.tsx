import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/server';
import { Card, PageHeader, Badge, Empty } from '@/components/ui';
import { ActionButton } from '@/components/action-button';
import { fmtLocal } from '@/lib/time';
import { qcVerdict, QC_VERDICT_AR, type QcReport } from '@/lib/qc';

const REASON = { MANUAL_MODE: 'الوضع اليدوي', ASSISTED_MODE: 'الوضع المساعد', QC_FAILED: 'فشل فحص الجودة' } as Record<string, string>;

export default async function ApprovalsPage() {
  await requirePageUser();
  const items = await prisma.approvalRequest.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, include: { advertisement: { include: { media: true, account: true, product: true } } } });
  return (
    <>
      <PageHeader title="طابور الموافقات" subtitle="راجع كل تصميم ونصه قبل النشر. لا يمكن اعتماد تصميم لم يجتز فحص الجودة." />
      {!items.length && <Empty>لا توجد عناصر بانتظار الموافقة.</Empty>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((r) => {
          const ad = r.advertisement;
          const img = ad.media.find((m) => m.role === 'FINAL');
          const qc = ad.qcReport as unknown as QcReport | null;
          const failed = qc?.checks.filter((c) => !c.passed) ?? [];
          return (
            <Card key={r.id} className="p-3">
              <Link href={`/ads/${ad.id}`}>{img && <img className="mb-3 aspect-[9/16] w-full rounded-lg object-cover" src={`/api/media/${img.storageKey}`} alt="" />}</Link>
              <div className="mb-1 flex flex-wrap gap-1"><Badge tone={r.reason === 'QC_FAILED' ? 'red' : 'blue'}>{REASON[r.reason] ?? r.reason}</Badge>{ad.dryRun && <Badge tone="amber">تجريبي</Badge>}{ad.format === 'REEL_VIDEO' && <Badge tone="navy">Reel</Badge>}<Badge tone={qcVerdict(qc) === 'PASS' ? 'green' : qcVerdict(qc) === 'REJECTED' ? 'red' : 'amber'}>QC: {QC_VERDICT_AR[qcVerdict(qc)]}</Badge></div>
              <div className="font-bold">{ad.headline}</div>
              <div className="text-xs text-slate-500">{ad.account.name} · {ad.product.titleAr} · {fmtLocal(r.createdAt)}</div>
              <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs text-slate-600">{ad.caption}</p>
              {failed.length > 0 && <ul className="mt-2 text-xs text-red-700">{failed.map((c) => <li key={c.id}>⛔ {c.label}{c.detail ? ` — ${c.detail}` : ''}</li>)}</ul>}
              <div className="mt-3 flex flex-wrap gap-2">
                {ad.qcPassed && <ActionButton url={`/api/ads/${ad.id}/approve`} label="اعتماد" variant="success" size="sm" />}
                {qc?.publishable && <ActionButton url={`/api/ads/${ad.id}/publish-now`} label="نشر الآن" variant="gold" size="sm" confirm="إرسال الإعلان للنشر الآن؟" />}
                <ActionButton url={`/api/ads/${ad.id}/reject`} label="رفض" variant="danger" size="sm" prompt="سبب الرفض (اختياري)" promptKey="note" />
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
