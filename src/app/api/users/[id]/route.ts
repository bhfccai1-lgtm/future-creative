import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { updateUser } from '@/lib/auth/users';

const Patch = z.object({ name: z.string().trim().min(2).max(80).optional(), role: z.string().max(20).optional(), active: z.boolean().optional(), unlock: z.boolean().optional() });

export const PATCH = api<{ params: Promise<{ id: string }> }>('users:manage', async (req, { params, user }) => {
  const { id } = await params;
  return NextResponse.json(await updateUser(id, Patch.parse(await req.json()), user));
});
