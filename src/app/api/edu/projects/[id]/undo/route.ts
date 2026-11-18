import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { undo } from '@/lib/edu/service';
import { eduUser } from '../../../_user';
export const POST = api<{ params: Promise<{ id: string }> }>('ads:create', async (_req, { params, user }) => {
  const p = await undo((await params).id, eduUser(user));
  return NextResponse.json({ ok: true, project: p, message: 'تم التراجع عن آخر تعديل ✓' });
});
