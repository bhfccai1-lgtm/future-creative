import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { printBoard } from '@/lib/print/board';
export const dynamic = 'force-dynamic';
/** orders board for the studio dashboard (own projects; all for admins) */
export const GET = api('ads:create', async (_req, { user }) => NextResponse.json({ ok: true, board: await printBoard(user.perms.includes('users:manage') ? null : user.email) }));
