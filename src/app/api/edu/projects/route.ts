import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { prisma } from '@/lib/db';
import { createProject } from '@/lib/edu/service';
import { eduUser } from '../_user';

export const GET = api('ads:create', async (_req, { user }) => {
  const u = eduUser(user);
  const rows = await prisma.eduProject.findMany({ where: u.perms.includes('users:manage') ? {} : { createdBy: u.email }, orderBy: { updatedAt: 'desc' }, take: 100, select: { id: true, title: true, type: true, updatedAt: true, source: true, qc: true } });
  return NextResponse.json({ projects: rows });
});
export const POST = api('ads:create', async (req, { user }) => {
  const p = await createProject(await req.json(), eduUser(user));
  return NextResponse.json({ ok: true, id: p.id, message: 'أُنشئ المشروع ✓' }, { status: 201 });
});
