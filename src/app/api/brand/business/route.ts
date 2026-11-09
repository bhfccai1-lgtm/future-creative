import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { prisma } from '@/lib/db';
import { getBusiness, LocationSchema } from '@/lib/business';
import { audit } from '@/lib/audit';

const Body = z.object({ nameAr: z.string().min(2), nameEn: z.string().min(2), defaultCtaAr: z.string().min(2).max(30), defaultCtaEn: z.string().min(2).max(30), defaultCtaMl: z.string().min(2).max(40), locations: z.array(LocationSchema).min(1).max(6) });
export const PUT = api('brand:manage', async (req, { user }) => {
  const data = Body.parse(await req.json());
  const b = await getBusiness();
  const u = await prisma.business.update({ where: { id: b.id }, data });
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'brand.business.update', details: { phones: data.locations.map((l) => l.phone) } });
  return NextResponse.json(u);
});
