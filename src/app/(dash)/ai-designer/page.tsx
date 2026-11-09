import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/server';
import { getSettings } from '@/lib/settings';
import { Card, PageHeader, Badge } from '@/components/ui';
import { fmtLocal } from '@/lib/time';
import { TEMPLATES } from '@/lib/render/templates';

const STEPS = [
  'تحديد الحسابات المستحقة للنشر', 'تحميل لغة الحساب وفئته وقواعد الهوية وسجله', 'اختيار منتج مناسب (تدوير + أداء موثق)', 'اختيار فكرة غير مستخدمة خلال 30 يومًا',
  'تحديد الجمهور والمناسبة', 'إنشاء موجز إبداعي منظم (JSON)', 'توليد المشهد عبر نموذج الصور (بدون نص أو شعار)', 'توليد النص الإعلاني',
  'تركيب الشعار الأصلي والنص والأرقام كطبقات ثابتة', 'فحوص الجودة الآلية', 'إنتاج الصيغة المطلوبة (صورة/فيديو MP4)', 'إرسال الوسائط إلى طابور النشر',
  'النشر عبر التكامل المعتمد', 'التحقق من نتيجة النشر الفعلية', 'حفظ الوسائط والبيانات والسجلات ومعرّفات المزود',
];

export default async function AiDesignerPage() {
  await requirePageUser();
  const [s, briefs, jobs] = await Promise.all([
    getSettings(),
    prisma.creativeBrief.findMany({ orderBy: { createdAt: 'desc' }, take: 20, include: { product: true, advertisements: { select: { id: true } } } }),
    prisma.aiGenerationJob.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
  ]);
  return (
    <>
      <PageHeader title="مصمم الإعلانات AI" subtitle="المدير الإبداعي الآلي — يعمل ضمن القيود التي يحددها المسؤول" />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="مراحل الدورة الإبداعية">
          <ol className="space-y-1 text-sm">{STEPS.map((t, i) => <li key={i} className="flex gap-2"><span className="w-6 shrink-0 rounded bg-navy-800 text-center text-xs font-bold leading-6 text-gold-400">{i + 1}</span>{t}</li>)}</ol>
        </Card>
        <Card title="القيود الحالية" className="xl:col-span-2">
          <dl className="grid gap-3 text-sm md:grid-cols-2">
            <div><dt className="text-slate-500">مزود النص / الصور</dt><dd className="ltr">{s.ai.dryRun ? 'dry-run (offline)' : `${s.ai.textModel} / ${s.ai.imageModel} (${s.ai.imageQuality})`}</dd></div>
            <div><dt className="text-slate-500">فترة منع التكرار</dt><dd>{s.duplicateWindowDays} يومًا لكل حساب</dd></div>
            <div className="md:col-span-2"><dt className="text-slate-500">الأسلوب الإبداعي</dt><dd>{s.ai.creativeStyle}</dd></div>
            <div className="md:col-span-2"><dt className="text-slate-500">قوالب التصميم</dt><dd className="flex flex-wrap gap-2">{TEMPLATES.map((t) => <Badge key={t.key} tone="gold">{t.name}</Badge>)}</dd></div>
            <div className="md:col-span-2 rounded bg-slate-50 p-3 text-xs text-slate-600">ممنوع على الذكاء الاصطناعي: الأسعار، العروض، مدد التسليم، الادعاءات غير الموثقة، رسم الشعار، كتابة أرقام الهواتف داخل الصورة. هذه القيود مفروضة في التعليمات وتُفحص آليًا بعد التوليد.</div>
          </dl>
        </Card>
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card title="آخر الموجزات الإبداعية">
          {briefs.map((b) => (
            <div key={b.id} className="border-t py-2 text-sm">
              <div className="font-bold">{b.headline} <span className="text-xs font-normal text-slate-500">— {b.product.titleAr}</span></div>
              <div className="text-xs text-slate-600">{b.idea}</div>
              <div className="text-[11px] text-slate-400">{b.provider} · {fmtLocal(b.createdAt)} {b.advertisements[0] && <Link className="underline" href={`/ads/${b.advertisements[0].id}`}>عرض الإعلان</Link>}</div>
            </div>
          ))}
          {!briefs.length && <p className="text-sm text-slate-500">لا توجد موجزات بعد.</p>}
        </Card>
        <Card title="مهام التوليد">
          <table className="w-full"><thead><tr><th className="th">النوع</th><th className="th">النموذج</th><th className="th">الحالة</th><th className="th">الوقت</th></tr></thead><tbody>
            {jobs.map((j) => <tr key={j.id} className="border-t"><td className="td">{j.kind}</td><td className="td ltr text-xs">{j.model}</td><td className="td"><Badge tone={j.status === 'SUCCEEDED' ? 'green' : j.status === 'RUNNING' ? 'blue' : 'red'}>{j.status}</Badge>{j.error && <div className="text-xs text-red-700">{j.error.slice(0, 160)}</div>}</td><td className="td text-xs">{fmtLocal(j.createdAt)}</td></tr>)}
          </tbody></table>
        </Card>
      </div>
    </>
  );
}
