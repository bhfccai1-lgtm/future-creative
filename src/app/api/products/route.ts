import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { api } from '@/lib/auth/server';
import { audit } from '@/lib/audit';
import { ProductInput } from '@/lib/validation';


export const GET = api('dashboard:view', async () => NextResponse.json(await prisma.product.findMany({ include: { category: true }, orderBy: { createdAt: 'asc' } })));
export const POST = api('products:manage', async (req, { user }) => {
  const data = ProductInput.parse(await req.json());
  const p = await prisma.product.create({ data });
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'product.create', targetType: 'product', targetId: p.id });
  return NextResponse.json(p, { status: 201 });
});
