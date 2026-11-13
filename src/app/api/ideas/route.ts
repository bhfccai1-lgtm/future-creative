import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { prisma } from '@/lib/db';

/** Open ideas of one account (approved first, then best-rated) — used by the «create design» wizard. */
export const GET = api('ads:create', async (req) => {
  const accountId = new URL(req.url).searchParams.get('accountId') ?? '';
  if (!accountId) return NextResponse.json([]);
  const rows = await prisma.idea.findMany({
    where: { accountId, status: { in: ['APPROVED', 'NEW'] }, product: { active: true } },
    orderBy: [{ status: 'desc' }, { score: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }], take: 6,
    select: { id: true, title: true, idea: true, hook: true, angle: true, format: true, score: true, status: true, productId: true },
  });
  return NextResponse.json(rows);
});
