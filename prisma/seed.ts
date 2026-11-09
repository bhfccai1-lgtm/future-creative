import { PrismaClient } from '@prisma/client';
import { CATEGORIES, PRODUCTS } from '../src/lib/catalog/seed-data';
import { DEFAULT_ROLES } from '../src/lib/auth/rbac';
import { DEFAULT_LOCATIONS } from '../src/lib/business';
import { TEMPLATES } from '../src/lib/render/templates';
import { SettingsSchema } from '../src/lib/settings';

const prisma = new PrismaClient();

/** Idempotent seed: safe to run repeatedly; never overwrites admin-edited values except catalog text on first insert. */
async function main() {
  for (const [name, permissions] of Object.entries(DEFAULT_ROLES)) {
    await prisma.role.upsert({ where: { name }, create: { name, permissions }, update: { permissions } });
  }

  let business = await prisma.business.findFirst();
  if (!business) {
    business = await prisma.business.create({ data: { nameAr: 'مطبعة إبداع المستقبل', nameEn: 'Future Creative Printing', locations: DEFAULT_LOCATIONS, timezone: 'Asia/Bahrain', currency: 'BHD' } });
  }

  for (const c of CATEGORIES) {
    await prisma.productCategory.upsert({ where: { slug: c.slug }, create: { slug: c.slug, nameAr: c.ar, nameEn: c.en, nameMl: c.ml }, update: {} });
  }
  const cats = Object.fromEntries((await prisma.productCategory.findMany()).map((c) => [c.slug, c.id]));
  for (const p of PRODUCTS) {
    await prisma.product.upsert({
      where: { slug: p.slug },
      create: { slug: p.slug, categoryId: cats[p.category], name: p.name, titleAr: p.ar, titleEn: p.en, titleMl: p.ml, targetAudience: p.audience, occasions: p.occasions, visualGuidelines: p.visual, recommendedMessages: p.msg, relevantAccountTags: p.tags },
      update: {},
    });
  }

  for (const t of TEMPLATES) {
    await prisma.designTemplate.upsert({ where: { key: t.key }, create: { key: t.key, name: t.name, format: 'IMAGE_STORY', layout: JSON.parse(JSON.stringify(t)) }, update: { layout: JSON.parse(JSON.stringify(t)), name: t.name } });
  }

  if (!(await prisma.systemSetting.findUnique({ where: { key: 'system' } }))) {
    await prisma.systemSetting.create({ data: { key: 'system', value: SettingsSchema.parse({}) as object } });
  }

  // 15 Instagram account slots — NOT connected, auto-publishing OFF. Rename and connect from the dashboard.
  const slots = Number(process.env.SEED_INSTAGRAM_SLOTS ?? 15);
  const existing = await prisma.socialAccount.count();
  if (existing === 0) {
    for (let i = 1; i <= slots; i++) {
      await prisma.socialAccount.create({ data: { businessId: business.id, name: `حساب إنستغرام ${String(i).padStart(2, '0')}`, platform: 'instagram', language: 'ar', publishFormat: 'IMAGE_STORY', autoPublishEnabled: false } });
    }
  }
  console.log(`Seed complete: ${PRODUCTS.length} products, ${CATEGORIES.length} categories, ${await prisma.socialAccount.count()} accounts.`);
}

main().finally(() => prisma.$disconnect());
