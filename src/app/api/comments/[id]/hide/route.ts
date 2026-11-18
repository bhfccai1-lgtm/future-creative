import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { hideComment } from '@/lib/comments/service';

/** Hide a spam comment on Instagram (and close it here). */
export const POST = api<{ params: Promise<{ id: string }> }>('publish:now', async (_req, { params, user }) => {
  await hideComment((await params).id, user);
  return NextResponse.json({ ok: true });
});
