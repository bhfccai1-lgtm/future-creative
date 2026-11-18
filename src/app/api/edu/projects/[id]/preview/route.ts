import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { preview } from '@/lib/edu/service';
import { eduUser } from '../../../_user';
export const POST = api<{ params: Promise<{ id: string }> }>('ads:create', async (_req, { params, user }) => NextResponse.json({ ok: true, ...(await preview((await params).id, eduUser(user))) }));
