import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { api } from '@/lib/auth/server';

/** Close without replying («لا يحتاج رد») or reopen. */
export const PATCH = api<{ params: Promise<{ id: string }> }>('ads:create', async (req, { params }) => {
  const { status } = z.object({ status: z.enum(['NEW', 'IGNORED']) }).parse(await req.json());
  return NextResponse.json(await prisma.socialComment.update({ where: { id: (await params).id }, data: { status } }));
});
