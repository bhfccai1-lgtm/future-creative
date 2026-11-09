import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { api } from '@/lib/auth/server';
import { audit } from '@/lib/audit';
import { ProductInput } from '@/lib/validation';

export const PATCH = api<{ params: Promise<{ id: string }> }>('products:manage', async (req, { params, user }) => {
  const { id } = await params;
  const data = ProductInput.partial().parse(await req.json());
  const p = await prisma.product.update({ where: { id }, data });
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'product.update', targetType: 'product', targetId: id, details: { fields: Object.keys(data) } });
  return NextResponse.json(p);
});
