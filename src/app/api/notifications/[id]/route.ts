import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { prisma } from '@/lib/db';
export const POST = api<{ params: Promise<{ id: string }> }>('dashboard:view', async (_req, { params }) => {
  const { id } = await params;
  if (id === 'all') await prisma.notification.updateMany({ where: { readAt: null }, data: { readAt: new Date() } });
  else await prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
  return NextResponse.json({ ok: true });
});
