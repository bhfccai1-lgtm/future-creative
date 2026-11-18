import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { deleteProject, loadProject, updateProject } from '@/lib/edu/service';
import { eduUser } from '../../_user';
type P = { params: Promise<{ id: string }> };
const Body = z.object({ content: z.unknown().optional(), settings: z.record(z.string(), z.unknown()).optional(), note: z.string().max(120).optional(), removeImage: z.string().max(40).optional() });

export const GET = api<P>('ads:create', async (_req, { params, user }) => NextResponse.json({ project: await loadProject((await params).id, eduUser(user)) }));
export const PATCH = api<P>('ads:create', async (req, { params, user }) => {
  const p = await updateProject((await params).id, Body.parse(await req.json()), eduUser(user));
  return NextResponse.json({ ok: true, project: p, message: 'حُفظت التعديلات ✓' });
});
export const DELETE = api<P>('ads:create', async (_req, { params, user }) => { await deleteProject((await params).id, eduUser(user)); return NextResponse.json({ ok: true, message: 'حُذف المشروع ✓' }); });
