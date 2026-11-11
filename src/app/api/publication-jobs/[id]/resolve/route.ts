import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { resolveUnknownJob } from '@/lib/publishing/reconcile';

const Body = z.object({ action: z.enum(['resubmit', 'cancel']) });
/** Operator decision for an UNKNOWN publication (a fresh provider lookup always runs before any resubmission). */
export const POST = api<{ params: Promise<{ id: string }> }>('publish:now', async (req, { params, user }) => {
  const { id } = await params;
  const { action } = Body.parse(await req.json());
  return NextResponse.json({ result: await resolveUnknownJob(id, action, user.email) });
});
