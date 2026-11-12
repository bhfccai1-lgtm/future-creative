import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { prisma } from '@/lib/db';

const Body = z.object({ status: z.enum(['NEW', 'APPROVED', 'REJECTED']) });
/** Approve / reject / reopen an idea. Used ideas stay used. */
export const PATCH = api<{ params: Promise<{ id: string }> }>('ads:create', async (req, { params }) => {
  const { id } = await params;
  const { status } = Body.parse(await req.json());
  const r = await prisma.idea.updateMany({ where: { id, status: { not: 'USED' } }, data: { status } });
  return NextResponse.json({ ok: r.count === 1 });
});
