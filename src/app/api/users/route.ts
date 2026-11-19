import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { createUser, listRoles, listUsers } from '@/lib/auth/users';

const Create = z.object({ email: z.string().email().max(200), name: z.string().trim().min(2).max(80), role: z.string().max(20), password: z.string().min(1).max(200) });

export const GET = api('users:manage', async (_req, { user }) => NextResponse.json({ users: await listUsers(user), roles: await listRoles() }));
export const POST = api('users:manage', async (req, { user }) => NextResponse.json(await createUser(Create.parse(await req.json()), user), { status: 201 }));
