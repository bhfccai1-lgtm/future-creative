import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/server';
import { can } from '@/lib/auth/rbac';
import { Card, PageHeader, Badge } from '@/components/ui';
import { ActionButton } from '@/components/action-button';
import { fmtLocal } from '@/lib/time';

const TONE = { INFO: 'blue', WARNING: 'amber', ERROR: 'red', CRITICAL: 'red' } as const;

export default async function AlertsPage() {
  const user = await requirePageUser();
  const [notes, failed, audit] = await Promise.all([
    prisma.notification.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.publicationJob.findMany({ where: { state: { in: ['FAILED', 'UNKNOWN'] } }, orderBy: { updatedAt: 'desc' }, take: 30, include: { account: true } }),
    can(user.perms, 'audit:view') ? prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }) : Promise.resolve([]),
  ]);
  return (
    <>
      <PageHeader title="الأخطاء والتنبيهات" actions={<ActionButton url="/api/notifications/all" label="تعليم الكل كمقروء" variant="outline" size="sm" />} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="التنبيهات">
          {notes.map((n) => (
            <div key={n.id} className={`border-t py-2 text-sm ${n.readAt ? 'opacity-60' : ''}`}>
              <div className="flex items-center gap-2"><Badge tone={TONE[n.level]}>{n.level}</Badge><b>{n.title}</b><span className="mr-auto text-xs text-slate-400">{fmtLocal(n.createdAt)}</span></div>
              <p className="mt-1 text-xs text-slate-600">{n.message}</p>
              {!n.readAt && <ActionButton url={`/api/notifications/${n.id}`} label="تم" variant="ghost" size="sm" />}
            </div>
          ))}
          {!notes.length && <p className="text-sm text-slate-500">لا توجد تنبيهات.</p>}
        </Card>
        <Card title="منشورات فاشلة أو غير مؤكدة">
          {failed.map((j) => <div key={j.id} className="border-t py-2 text-sm"><Link className="font-bold text-navy-700 hover:underline" href={`/ads/${j.advertisementId}`}>{j.account.name}</Link> — {j.state} <span className="text-xs text-slate-500">{fmtLocal(j.updatedAt)}</span><p className="text-xs text-red-700">{j.lastError}</p></div>)}
          {!failed.length && <p className="text-sm text-slate-500">لا يوجد.</p>}
        </Card>
      </div>
      {audit.length > 0 && (
        <Card title="سجل التدقيق (Audit log)" className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[800px]"><thead><tr><th className="th">الوقت</th><th className="th">المنفذ</th><th className="th">الإجراء</th><th className="th">الهدف</th><th className="th">تفاصيل</th></tr></thead>
            <tbody>{audit.map((a) => <tr key={a.id} className="border-t"><td className="td text-xs">{fmtLocal(a.createdAt, undefined, 'MM-dd HH:mm:ss')}</td><td className="td text-xs ltr">{a.actorLabel}</td><td className="td text-xs ltr">{a.action}</td><td className="td text-xs ltr">{a.targetType ? `${a.targetType}:${a.targetId?.slice(0, 10)}` : ''}</td><td className="td max-w-md truncate text-xs ltr">{a.details ? JSON.stringify(a.details).slice(0, 160) : ''}</td></tr>)}</tbody></table>
        </Card>
      )}
    </>
  );
}
