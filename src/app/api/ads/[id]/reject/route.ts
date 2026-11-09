import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { rejectAdvertisement } from '@/lib/publishing/jobs';
const Body = z.object({ note: z.string().max(500).optional() });
export const POST = api<{ params: Promise<{ id: string }> }>('ads:approve', async (req, { params, user }) => {
  const { note } = Body.parse(await req.json().catch(() => ({})));
  await rejectAdvertisement((await params).id, { id: user.sub, email: user.email }, note);
  return NextResponse.json({ ok: true });
});
