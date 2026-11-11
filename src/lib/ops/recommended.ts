import { prisma } from '../db';

/**
 * «الإعداد الموصى به» — one click for all accounts: every 7 hours, smart format variety (Reel/carousel/post/story),
 * and categories matched to each account's name (only for accounts that have no categories/products chosen yet).
 * Accounts whose name doesn't match a niche (main brand, branches) keep ALL products.
 */
const NICHES: { match: RegExp; cats: string[]; label: string }[] = [
  { match: /mug|كوب|أكواب/i, label: 'أكواب وهدايا', cats: ['طباعة الأكواب', 'الهدايا الشخصية', 'هدايا الموظفين والعملاء', 'الهدايا الترويجية والشخصية'] },
  { match: /educat|school|تعليم|مدارس/i, label: 'تعليم ومدارس', cats: ['الأطفال والمدارس', 'المطبوعات التعليمية', 'الطباعة المكتبية', 'المعارض والمؤتمرات'] },
  { match: /gift|هدايا|هدية/i, label: 'هدايا', cats: ['الهدايا الشخصية', 'الهدايا الترويجية والشخصية', 'المطبوعات الفاخرة', 'الباقات', 'الأعراس والحفلات', 'طباعة الأكواب'] },
  { match: /sticker|label|ملصق/i, label: 'ملصقات وليبلات', cats: ['الملصقات والليبلات', 'المشاريع المنزلية', 'واجهات المحلات', 'المخازن وتنظيم العمل', 'العطور والبخور والشموع', 'التغليف والعرض'] },
  { match: /business|corporate|شركات/i, label: 'الشركات', cats: ['مطبوعات الشركات', 'العقارات والمكاتب', 'المعارض والمؤتمرات', 'الطباعة المكتبية', 'هدايا الموظفين والعملاء', 'الباقات', 'المطبوعات التسويقية'] },
  { match: /occasion|wedding|event|مناسبات|أعراس/i, label: 'المناسبات', cats: ['المناسبات والأعراس', 'الأعراس والحفلات', 'المطبوعات الفاخرة', 'الحملات والمبادرات', 'الهدايا الشخصية'] },
  { match: /adv|اعلان|إعلان/i, label: 'الإعلان والواجهات', cats: ['البنرات والطباعة الكبيرة', 'اللوحات والديكور', 'واجهات المحلات', 'المعارض والمؤتمرات', 'الحملات والمبادرات', 'المطبوعات التسويقية'] },
  { match: /india|هند/i, label: 'الجالية الهندية', cats: ['المشاريع المنزلية', 'المطاعم والمقاهي', 'واجهات المحلات', 'الهدايا الشخصية', 'المطبوعات التسويقية', 'طباعة الملابس'] },
];

export interface PlanRow { id: string; name: string; intervalHours: number; formatStrategy: string; niche: string | null; categories: string[]; keepsExisting: boolean }

export async function planRecommended(intervalHours = 7): Promise<PlanRow[]> {
  const [accounts, cats] = await Promise.all([
    prisma.socialAccount.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.productCategory.findMany({ select: { id: true, nameAr: true } }),
  ]);
  const byName = new Map(cats.map((c) => [c.nameAr, c.id]));
  return accounts.map((a) => {
    const key = `${a.name} ${a.handle ?? ''}`;
    const niche = NICHES.find((n) => n.match.test(key));
    const keepsExisting = a.allowedCategoryIds.length > 0 || a.allowedProductIds.length > 0;
    const categories = keepsExisting || !niche ? [] : niche.cats.filter((c) => byName.has(c));
    return { id: a.id, name: a.name, intervalHours, formatStrategy: 'GROWTH_MIX', niche: niche?.label ?? null, categories, keepsExisting };
  });
}

export async function applyRecommended(intervalHours = 7) {
  const plan = await planRecommended(intervalHours);
  const cats = new Map((await prisma.productCategory.findMany({ select: { id: true, nameAr: true } })).map((c) => [c.nameAr, c.id]));
  for (const r of plan) {
    const a = await prisma.socialAccount.findUniqueOrThrow({ where: { id: r.id } });
    await prisma.socialAccount.update({ where: { id: r.id }, data: {
      publishIntervalMinutes: intervalHours * 60, maxDailyAds: Math.max(1, Math.ceil(24 / intervalHours)), formatStrategy: 'GROWTH_MIX',
      ...(a.nextPublishAt && a.nextPublishAt.getTime() > Date.now() + intervalHours * 3600_000 ? { nextPublishAt: new Date(Date.now() + intervalHours * 3600_000) } : {}),
      ...(r.categories.length ? { allowedCategoryIds: r.categories.map((c) => cats.get(c)!).filter(Boolean) } : {}),
    } });
  }
  return plan;
}
