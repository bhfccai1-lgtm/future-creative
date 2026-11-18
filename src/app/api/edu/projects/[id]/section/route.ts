import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { rewriteSection } from '@/lib/edu/service';
import { eduUser } from '../../../_user';
export const POST = api<{ params: Promise<{ id: string }> }>('ads:create', async (req, { params, user }) => {
  const { sectionId } = z.object({ sectionId: z.string().max(40) }).parse(await req.json());
  const p = await rewriteSection((await params).id, sectionId, eduUser(user));
  return NextResponse.json({ ok: true, project: p, message: 'أُعيدت كتابة القسم ✓' });
});
