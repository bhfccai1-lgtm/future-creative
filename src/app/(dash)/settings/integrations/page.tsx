import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/server';
import { getSettings, secretStatus } from '@/lib/settings';
import { Card, PageHeader, Badge } from '@/components/ui';
import { IntegrationsForm } from '@/components/integrations-form';
import { ConnBadge, PLATFORM_AR } from '@/components/state-badge';
import { fmtLocal } from '@/lib/time';

export default async function IntegrationsPage() {
  await requirePageUser('settings:integrations');
  const s = await getSettings();
  const [token, conns, recon] = await Promise.all([
    secretStatus('METRICOOL_API_TOKEN'),
    prisma.socialConnection.findMany({ include: { account: true }, orderBy: { updatedAt: 'desc' } }),
    prisma.publicationJob.groupBy({ by: ['state'], _count: true, where: { state: { in: ['UNKNOWN', 'SCHEDULED', 'FAILED'] } } }),
  ]);
  return (
    <>
      <PageHeader title="إعدادات الربط" subtitle="Metricool هو بوابة النشر الأساسية. لا تُستخدم كلمات مرور الحسابات ولا واجهات غير رسمية." />
      <Card title="Metricool" className="mb-6" actions={s.metricool.lastCheckAt ? <Badge tone={s.metricool.lastCheckOk ? 'green' : 'red'}>{s.metricool.lastCheckOk ? 'متصل' : 'فشل التحقق'} · {fmtLocal(new Date(s.metricool.lastCheckAt))}</Badge> : <Badge>لم يُختبر</Badge>}>
        {s.metricool.lastCheckMessage && <p className="mb-3 text-sm text-slate-600">{s.metricool.lastCheckMessage}</p>}
        <IntegrationsForm m={s.metricool} token={token} />
      </Card>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="ربط الحسابات بالمزود">
          <table className="w-full"><tbody>{conns.map((c) => <tr key={c.id} className="border-t"><td className="td">{c.account.name}<div className="text-xs text-slate-500">{PLATFORM_AR[c.account.platform]}</div></td><td className="td ltr text-xs">{c.provider} / {c.providerBrandId}</td><td className="td"><ConnBadge status={c.status} /></td><td className="td text-xs text-red-700">{c.lastError}</td></tr>)}</tbody></table>
          {!conns.length && <p className="text-sm text-slate-500">لم يُربط أي حساب بعد.</p>}
        </Card>
        <Card title="حالة المطابقة (Reconciliation)">
          <ul className="text-sm">{['SCHEDULED', 'UNKNOWN', 'FAILED'].map((st) => <li key={st} className="flex justify-between border-t py-2"><span>{st}</span><b>{recon.find((r) => r.state === st)?._count ?? 0}</b></li>)}</ul>
          <p className="mt-2 text-xs text-slate-500">تُطابق المهام كل 5 دقائق مع المزود. لا يُعرض «منشور» إلا بعد تأكيد المزود.</p>
        </Card>
      </div>
      <Card title="مزودات أخرى" className="mt-6">
        <p className="text-sm text-slate-600">واجهة المحوّل (PublishingAdapter) جاهزة لإضافة الواجهات الرسمية مباشرة (Meta Graph API، TikTok Content Posting API، YouTube Data API …). غير مفعّلة في هذا الإصدار — راجع docs/FEATURES.md.</p>
      </Card>
    </>
  );
}
