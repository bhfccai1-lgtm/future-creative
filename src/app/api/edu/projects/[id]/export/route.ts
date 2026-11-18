import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { exportFiles } from '@/lib/edu/service';
import { eduUser } from '../../../_user';
export const POST = api<{ params: Promise<{ id: string }> }>('ads:create', async (req, { params, user }) => {
  const { formats } = z.object({ formats: z.array(z.enum(['pdf', 'png', 'jpg'])).min(1).default(['pdf']) }).parse(await req.json().catch(() => ({})));
  return NextResponse.json({ ok: true, ...(await exportFiles((await params).id, formats, eduUser(user))) });
});
