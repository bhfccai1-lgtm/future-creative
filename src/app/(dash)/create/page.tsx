import Link from 'next/link';
import { CheckCircle2, ShieldAlert } from 'lucide-react';
import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/server';
import { getSettings } from '@/lib/settings';
import { Card } from '@/components/ui';
import { GenerateForm } from '@/components/generate-form';
import { PLATFORM_AR, LANG_AR } from '@/components/state-badge';
import { estimateAdCost } from '@/lib/ai/cost';
import { upcomingOccasions } from '@/lib/creative/planner';
import { OCCASIONS } from '@/lib/creative/options';

const COST_FORMATS = ['REEL_VIDEO', 'IMAGE_CAROUSEL', 'IMAGE_FEED', 'IMAGE_STORY', 'IMAGE_SQUARE'] as const;

export default async function CreatePage({ searchParams }: { searchParams: Promise<{ idea?: string }> }) {
  await requirePageUser('ads:create');
  const initialIdea = ((await searchParams).idea ?? '').slice(0, 500);
  const [accounts, products, s, logo] = await Promise.all([
    prisma.socialAccount.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.product.findMany({ where: { active: true }, include: { category: { select: { nameAr: true } } }, orderBy: [{ performanceScore: 'desc' }, { titleAr: 'asc' }] }),
    getSettings(),
    prisma.brandAsset.findFirst({ where: { kind: 'LOGO_PRIMARY', active: true, approved: true } }),
  ]);
  const costs: Record<string, number> = { default: estimateAdCost(s) };
  for (const f of COST_FORMATS) costs[f] = estimateAdCost(s, f);
  const seen = new Set<string>();
  const upcoming = upcomingOccasions(new Date(), 60)
    .map((w) => ({ value: w.key, ar: OCCASIONS.find((o) => o.value === w.key)?.ar ?? '', days: Math.max(0, w.daysToPeak) }))
    .filter((o) => o.ar && !seen.has(o.value) && seen.add(o.value)).slice(0, 5);
  const withPhoto = products.filter((p) => p.photoKey).length;
  const refs = [s.ai.styleReferenceKey, ...Object.values(s.ai.styleRefsByFormat ?? {}).map((r) => r?.key)].filter(Boolean).length;
  const checks = [
    { ok: !!logo, t: 'الشعار الرسمي معتمد', fix: '/settings/brand' },
    { ok: withPhoto >= Math.min(5, products.length), t: `صور حقيقية: ${withPhoto} من ${products.length} منتج`, fix: '/products' },
    { ok: refs > 0, t: refs ? `مراجع التصميم: ${refs}` : 'لا مرجع تصميم بعد', fix: '/settings/ai' },
  ];

  return (
    <>
      <div className="relative mb-5 overflow-hidden rounded-2xl bg-gradient-to-l from-navy-900 via-navy-800 to-navy-700 px-5 py-5 text-white">
        <svg aria-hidden className="pointer-events-none absolute bottom-0 left-0 h-full w-1/2 opacity-20" viewBox="0 0 400 120" preserveAspectRatio="xMinYMax slice">
          <g fill="none" stroke="#e0c063" strokeWidth="1.5"><path d="M0 110 H400 M30 110 V70 H50 V110 M60 110 V50 H75 V110 M120 110 L135 30 L150 110 M165 110 L180 30 L195 110 M132 62 H183 M230 110 V60 H255 V110 M300 108 Q335 112 370 108 L360 98 H310 Z M335 98 V50 L365 92" /></g>
        </svg>
        <div className="relative flex flex-wrap items-center gap-4">
          <div className="border-r-4 border-gold-500 pr-3">
            <h1 className="text-xl font-extrabold sm:text-2xl">إنشاء تصميم جديد</h1>
            <p className="mt-0.5 max-w-xl text-xs leading-5 text-navy-100">اختر المنتج والفكرة، ويصمم المخرج الإبداعي الإعلان، ثم يضيف النظام الشعار الأصلي وزر الطلب وأرقام الفرعين بدقة، ويفحص الجودة قبل وصوله لموافقتك.</p>
          </div>
          <ul className="mr-auto flex flex-wrap gap-1.5 text-[11px]">
            {checks.map((c) => (
              <li key={c.t}><Link href={c.fix} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-bold ring-1 ${c.ok ? 'bg-white/5 text-navy-50 ring-white/15' : 'bg-amber-400/15 text-amber-200 ring-amber-300/40 hover:bg-amber-400/25'}`}>
                {c.ok ? <CheckCircle2 size={13} className="text-emerald-300" /> : <ShieldAlert size={13} />}{c.t}</Link></li>
            ))}
          </ul>
        </div>
      </div>
      {!logo && <div role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">لا يوجد شعار رسمي معتمد — التوليد محظور حتى رفع الشعار الأصلي واعتماده من «إعدادات الهوية».</div>}
      {s.ai.dryRun && <div className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">وضع التجربة مفعّل: يُنشأ مشهد إجرائي محلي دون استدعاء OpenAI ودون تكلفة. هذه المعاينات <b>غير قابلة للنشر</b>.</div>}
      <Card>
        <GenerateForm accounts={accounts.map((a) => ({ id: a.id, label: `${a.name} — ${PLATFORM_AR[a.platform]} — ${LANG_AR[a.language]}` }))}
          products={products.map((p) => ({ id: p.id, label: p.titleAr, category: p.category?.nameAr ?? '', photoKey: p.photoKey }))}
          initialIdea={initialIdea} costs={costs} upcoming={upcoming} dryRun={s.ai.dryRun} blocked={!logo} />
      </Card>
      <p className="mt-3 text-xs text-slate-500">تريد تكرار الإعلان بتصميم جديد كل عدة ساعات أو في تاريخ محدد؟ استخدم <Link className="font-bold text-navy-700 underline" href="/campaigns">الحملات المتكررة</Link>.</p>
    </>
  );
}
