import { z } from 'zod';
import type { Business } from '@prisma/client';
import { prisma } from './db';
import type { Lang } from './render/fonts';
import type { ContactLine } from './render/compose';

export const LocationSchema = z.object({
  key: z.string().regex(/^[a-z0-9-]+$/), nameAr: z.string().min(1), nameEn: z.string().min(1), nameMl: z.string().optional(), nameHi: z.string().optional(),
  phone: z.string().regex(/^\d{8}$/, 'رقم بحريني من 8 أرقام'),
});
export type Location = z.infer<typeof LocationSchema>;

export const DEFAULT_LOCATIONS: Location[] = [
  { key: 'saar', nameAr: 'سار', nameEn: 'Saar', nameMl: 'സാർ', nameHi: 'सार', phone: '33316319' },
  { key: 'salmabad', nameAr: 'سلماباد', nameEn: 'Salmabad', nameMl: 'സൽമാബാദ്', nameHi: 'सलमाबाद', phone: '34315316' },
];

export async function getBusiness(): Promise<Business> {
  const b = await prisma.business.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!b) throw new Error('Business record missing — run `npm run db:seed`.');
  return b;
}

export const locationsOf = (b: Business): Location[] => z.array(LocationSchema).parse(b.locations);

export function contactLines(b: Business, lang: Lang): ContactLine[] {
  return locationsOf(b).map((l) => ({
    key: l.key, phone: l.phone,
    label: lang === 'ar' ? `فرع ${l.nameAr}` : lang === 'ml' ? (l.nameMl ?? l.nameEn) : lang === 'hi' ? `${l.nameHi ?? HI_BRANCH[l.key] ?? l.nameEn} ब्रांच` : l.nameEn,
  }));
}

/** Hindi names of the default branches (saved locations from before Hindi have no nameHi) */
const HI_BRANCH: Record<string, string> = { saar: 'सार', salmabad: 'सलमाबाद' };
export const CTA_HI = 'अभी ऑर्डर करें';
export const ctaFor = (b: Business, lang: Lang) => (lang === 'ar' ? b.defaultCtaAr : lang === 'ml' ? b.defaultCtaMl : lang === 'hi' ? CTA_HI : b.defaultCtaEn);
