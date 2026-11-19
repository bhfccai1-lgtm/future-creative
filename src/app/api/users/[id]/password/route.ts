import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { resetPassword } from '@/lib/auth/users';

export const POST = api<{ params: Promise<{ id: string }> }>('users:manage', async (req, { params, user }) => {
  const { id } = await params;
  const { password } = z.object({ password: z.string().min(1).max(200) }).parse(await req.json());
  return NextResponse.json(await resetPassword(id, password, user));
});
