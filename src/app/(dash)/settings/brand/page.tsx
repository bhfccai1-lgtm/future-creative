import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/server';
import { getBusiness, locationsOf } from '@/lib/business';
import { Card, PageHeader, Badge } from '@/components/ui';
import { LogoUpload, BusinessForm, FeaturesForm } from '@/components/brand-forms';
import { getSettings } from '@/lib/settings';
import { ActionButton } from '@/components/action-button';
import { fmtLocal } from '@/lib/time';

export default async function BrandPage() {
  await requirePageUser('brand:manage');
  const b = await getBusiness();
  const logos = await prisma.brandAsset.findMany({ where: { businessId: b.id, kind: 'LOGO_PRIMARY' }, orderBy: { createdAt: 'desc' } });
  const active = logos.find((l) => l.active && l.approved);
  const previewAd = await prisma.advertisement.findFirst({ where: { logoSha256: active?.sha256 ?? '__none__' }, orderBy: { createdAt: 'desc' }, include: { media: { where: { role: 'FINAL' } } } });
  return (
    <>
      <PageHeader title="إعدادات الهوية" subtitle="الشعار الرسمي يُدرج كطبقة منفصلة دون أي تعديل. بدون شعار معتمد يتوقف التوليد والنشر الآلي." />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="الشعار الرسمي المعتمد">
          {active ? (
            <div className="flex items-start gap-4">
              <div className="rounded-lg bg-[conic-gradient(#e5e7eb_25%,#fff_0_50%,#e5e7eb_0_75%,#fff_0)] bg-[length:16px_16px] p-3"><img src={`/api/media/${active.storageKey}`} alt="الشعار" className="max-h-32 max-w-56" /></div>
              <dl className="text-sm"><dt className="text-slate-500">SHA-256</dt><dd className="ltr break-all text-xs">{active.sha256}</dd><dt className="mt-2 text-slate-500">الأبعاد</dt><dd className="ltr">{active.width}×{active.height}</dd><dt className="mt-2 text-slate-500">اعتمد بواسطة</dt><dd>{active.approvedBy} · {fmtLocal(active.approvedAt)}</dd></dl>
            </div>
          ) : <p className="rounded bg-red-50 p-3 text-sm font-bold text-red-700">لا يوجد شعار معتمد — النشر الآلي محظور.</p>}
          <hr className="my-4" />
          <LogoUpload />
        </Card>
        <Card title="معاينة على تصميم حقيقي">
          {previewAd?.media[0] ? <img className="mx-auto max-h-[480px] rounded-lg" src={`/api/media/${previewAd.media[0].storageKey}`} alt="" /> : <p className="text-sm text-slate-500">أنشئ إعلانًا (يمكن في وضع التجربة) لمعاينة الشعار داخل التصميم قبل تفعيل الأتمتة.</p>}
        </Card>
      </div>
      <Card title="نسخ الشعار المرفوعة" className="mt-6">
        <div className="grid gap-4 md:grid-cols-4">
          {logos.map((l) => (
            <div key={l.id} className="rounded-lg border p-3 text-xs">
              <img src={`/api/media/${l.storageKey}`} alt="" className="mb-2 h-20 w-full object-contain" />
              <div className="ltr truncate">{l.sha256.slice(0, 20)}…</div>
              <div className="my-1">{l.active ? <Badge tone="green">نشط ومعتمد</Badge> : l.approved ? <Badge>معتمد سابقًا</Badge> : <Badge tone="amber">بانتظار الاعتماد</Badge>}</div>
              {!l.active && <ActionButton url={`/api/brand/logo/${l.id}/approve`} label="اعتماد وتفعيل" variant="success" size="sm" confirm="اعتماد هذا الملف كشعار رسمي؟ الإعلانات المجدولة بالشعار السابق ستفشل في فحص البصمة وتحتاج إعادة توليد." />}
            </div>
          ))}
        </div>
      </Card>
      <Card title="مزايا المطبعة (أيقونات الملصق الذهبي)" className="mt-6"><FeaturesForm f={(await getSettings()).brandFeatures} /></Card>
      <Card title="بيانات الشركة والفروع" className="mt-6"><BusinessForm b={{ nameAr: b.nameAr, nameEn: b.nameEn, defaultCtaAr: b.defaultCtaAr, defaultCtaEn: b.defaultCtaEn, defaultCtaMl: b.defaultCtaMl, locations: locationsOf(b) }} /></Card>
    </>
  );
}
