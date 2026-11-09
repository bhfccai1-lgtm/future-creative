import { z } from 'zod';
import type { Business } from '@prisma/client';
import { prisma } from './db';
import type { Lang } from './render/fonts';
import type { ContactLine } from './render/compose';

export const LocationSchema = z.object({
  key: z.string().regex(/^[a-z0-9-]+$/), nameAr: z.string().min(1), nameEn: z.string().min(1), nameMl: z.string().optional(),
  phone: z.string().regex(/^\d{8}$/, 'رقم بحريني من 8 أرقام'),
});
export type Location = z.infer<typeof LocationSchema>;

export const DEFAULT_LOCATIONS: Location[] = [
  { key: 'saar', nameAr: 'سار', nameEn: 'Saar', nameMl: 'സാർ', phone: '33316319' },
  { key: 'salmabad', nameAr: 'سلماباد', nameEn: 'Salmabad', nameMl: 'സൽമാബാദ്', phone: '34315316' },
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
    label: lang === 'ar' ? `فرع ${l.nameAr}` : lang === 'ml' ? (l.nameMl ?? l.nameEn) : l.nameEn,
  }));
}

export const ctaFor = (b: Business, lang: Lang) => (lang === 'ar' ? b.defaultCtaAr : lang === 'ml' ? b.defaultCtaMl : b.defaultCtaEn);
