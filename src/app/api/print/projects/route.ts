import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { prisma } from '@/lib/db';
import { createPrint } from '@/lib/print/service';
import { printUser } from '../_user';
export const dynamic = 'force-dynamic';
export const GET = api('ads:create', async (_req, { user }) => {
  const rows = await prisma.printProject.findMany({ where: user.perms.includes('users:manage') ? {} : { createdBy: user.email }, orderBy: { updatedAt: 'desc' }, take: 100, select: { id: true, title: true, productId: true, status: true, updatedAt: true, mockupKey: true } });
  return NextResponse.json({ ok: true, projects: rows });
});
export const POST = api('ads:create', async (req, { user }) => NextResponse.json({ ok: true, project: await createPrint(await req.json(), printUser(user)) }, { status: 201 }));
