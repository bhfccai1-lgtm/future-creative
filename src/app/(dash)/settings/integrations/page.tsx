import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/server';
import { getSettings, secretStatus } from '@/lib/settings';
import { Card, PageHeader, Badge } from '@/components/ui';
import { IntegrationsForm } from '@/components/integrations-form';
import { N8nForm } from '@/components/n8n-form';
import { GoogleArchiveForm } from '@/components/google-archive-form';
import { WhatsappSettings } from '@/components/whatsapp-settings';
import { whatsappStatus } from '@/lib/integrations/whatsapp-catalog';
import { ActionButton } from '@/components/action-button';
import { EVENTS } from '@/lib/integrations/events';
import { env } from '@/lib/env';
import { ConnBadge, PLATFORM_AR } from '@/components/state-badge';
import { fmtLocal } from '@/lib/time';

export default async function IntegrationsPage() {
  await requirePageUser('settings:integrations');
  const s = await getSettings();
  const [token, conns, recon, n8nSecret, n8nToken, deliveries, tgStatus] = await Promise.all([
    secretStatus('METRICOOL_API_TOKEN'),
    prisma.socialConnection.findMany({ include: { account: true }, orderBy: { updatedAt: 'desc' } }),
    prisma.publicationJob.groupBy({ by: ['state'], _count: true, where: { state: { in: ['UNKNOWN', 'SCHEDULED', 'FAILED'] } } }),
    secretStatus('N8N_WEBHOOK_SECRET'), secretStatus('N8N_API_TOKEN'),
    prisma.webhookDelivery.findMany({ orderBy: { createdAt: 'desc' }, take: 15 }),
    secretStatus('TELEGRAM_BOT_TOKEN'),
  ]);
  return (
    <>
      <PageHeader title="إعدادات الربط" subtitle="Metricool هو بوابة النشر الأساسية. لا تُستخدم كلمات مرور الحسابات ولا واجهات غير رسمية." />
      <Card collapsible title="Metricool" className="mb-6" actions={s.metricool.lastCheckAt ? <Badge tone={s.metricool.lastCheckOk ? 'green' : 'red'}>{s.metricool.lastCheckOk ? 'متصل' : 'فشل التحقق'} · {fmtLocal(new Date(s.metricool.lastCheckAt))}</Badge> : <Badge>لم يُختبر</Badge>}>
        {s.metricool.lastCheckMessage && <p className="mb-3 text-sm text-slate-600">{s.metricool.lastCheckMessage}</p>}
        <IntegrationsForm m={s.metricool} token={token} />
      </Card>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card collapsible title="ربط الحسابات بالمزود">
          <table className="w-full"><tbody>{conns.map((c) => <tr key={c.id} className="border-t"><td className="td">{c.account.name}<div className="text-xs text-slate-500">{PLATFORM_AR[c.account.platform]}</div></td><td className="td ltr text-xs">{c.provider} / {c.providerBrandId}</td><td className="td"><ConnBadge status={c.status} /></td><td className="td text-xs text-red-700">{c.lastError}</td></tr>)}</tbody></table>
          {!conns.length && <p className="text-sm text-slate-500">لم يُربط أي حساب بعد.</p>}
        </Card>
        <Card collapsible title="حالة المطابقة (Reconciliation)">
          <ul className="text-sm">{['SCHEDULED', 'UNKNOWN', 'FAILED'].map((st) => <li key={st} className="flex justify-between border-t py-2"><span>{st}</span><b>{recon.find((r) => r.state === st)?._count ?? 0}</b></li>)}</ul>
          <p className="mt-2 text-xs text-slate-500">تُطابق المهام كل 5 دقائق مع المزود. لا يُعرض «منشور» إلا بعد تأكيد المزود.</p>
        </Card>
      </div>
      <Card collapsible title="n8n — الأتمتة" className="mt-6" actions={<Badge tone={s.n8n.enabled ? 'green' : 'slate'}>{s.n8n.enabled ? 'مفعّل' : 'غير مفعّل'}</Badge>}>
        <p className="mb-3 text-sm text-slate-600">يرسل النظام أحداثًا موقّعة (HMAC) إلى n8n مع إعادة المحاولة تلقائيًا، ويستقبل من n8n طلبات بمفتاح API. النشر يبقى دائمًا عبر مسار النظام المحمي. قوالب جاهزة: <span className="ltr">deploy/n8n/</span></p>
        <N8nForm n8n={s.n8n} events={EVENTS} secret={n8nSecret.configured} telegram={tgStatus.configured} token={n8nToken.configured} apiBase={env().PUBLIC_BASE_URL.replace(/\/$/, '')} />
        <div className="mt-4 overflow-x-auto">
          <div className="label">آخر الأحداث المرسلة</div>
          <table className="w-full min-w-[600px] text-xs"><tbody>{deliveries.map((d) => (
            <tr key={d.id} className="border-t"><td className="td ltr">{d.event}</td><td className="td"><Badge tone={d.status === 'DELIVERED' ? 'green' : d.status === 'DEAD' ? 'red' : 'amber'}>{d.status}</Badge></td><td className="td">{d.attempts} محاولة{d.lastStatus ? ` · HTTP ${d.lastStatus}` : ''}</td><td className="td">{fmtLocal(d.createdAt)}</td><td className="td text-red-700">{d.lastError}</td><td className="td">{d.status === 'DEAD' && <ActionButton url="/api/settings/n8n/redeliver" body={{ id: d.id }} size="sm" variant="outline" label="إعادة إرسال" />}</td></tr>
          ))}</tbody></table>
          {!deliveries.length && <p className="text-sm text-slate-500">لا توجد أحداث بعد.</p>}
        </div>
      </Card>
      <Card collapsible title="أرشيف Google Drive و Sheets (مباشر)" className="mt-6"><GoogleArchiveForm configured={(await secretStatus('GOOGLE_ARCHIVE_URL')).configured} /></Card>
      <Card collapsible title="واتساب — الكتالوج وحزمة الحالة" className="mt-6">
        <WhatsappSettings initial={await whatsappStatus()} categories={await prisma.productCategory.findMany({ select: { id: true, nameAr: true }, orderBy: { nameAr: 'asc' } })} accounts={await prisma.socialAccount.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } })} />
      </Card>
      <Card collapsible title="مزودات أخرى" className="mt-6">
        <p className="text-sm text-slate-600">واجهة المحوّل (PublishingAdapter) جاهزة لإضافة الواجهات الرسمية مباشرة (Meta Graph API، TikTok Content Posting API، YouTube Data API …). غير مفعّلة في هذا الإصدار — راجع docs/FEATURES.md.</p>
      </Card>
    </>
  );
}
