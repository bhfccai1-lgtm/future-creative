import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { deletePrint, loadPrint, updatePrint } from '@/lib/print/service';
import { printUser } from '../../_user';
type P = { params: Promise<{ id: string }> };
export const GET = api<P>('ads:create', async (_req, { params, user }) => NextResponse.json({ ok: true, project: await loadPrint((await params).id, printUser(user)) }));
export const PATCH = api<P>('ads:create', async (req, { params, user }) => {
  const body = z.object({ brief: z.record(z.string(), z.unknown()).optional(), conceptKey: z.enum(['A', 'B', 'C']).optional(), note: z.string().max(120).optional() }).parse(await req.json());
  return NextResponse.json({ ok: true, project: await updatePrint((await params).id, body as never, printUser(user)) });
});
export const DELETE = api<P>('ads:create', async (_req, { params, user }) => { await deletePrint((await params).id, printUser(user)); return NextResponse.json({ ok: true }); });
