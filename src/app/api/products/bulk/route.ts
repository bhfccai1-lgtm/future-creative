import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';
const Body = z.object({ ids: z.array(z.string()).max(5000).optional(), categoryId: z.string().optional(), active: z.boolean() }).refine((b) => b.ids?.length || b.categoryId, 'ids or categoryId required');
/** Activate / deactivate many products at once (selected ids or a whole category). */
export const POST = api('products:manage', async (req, { user }) => {
  const b = Body.parse(await req.json());
  const r = await prisma.product.updateMany({ where: b.ids?.length ? { id: { in: b.ids } } : { categoryId: b.categoryId }, data: { active: b.active } });
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'products.bulk_active', details: { count: r.count, active: b.active, categoryId: b.categoryId ?? null } });
  return NextResponse.json({ updated: r.count });
});
