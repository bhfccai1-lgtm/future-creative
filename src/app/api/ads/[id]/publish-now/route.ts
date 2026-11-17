import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { publishNow } from '@/lib/publishing/jobs';
const Body = z.object({ overrideQc: z.boolean().optional(), reason: z.string().max(500).nullish() });
/** "نشر الآن" — returns the queued job. `overrideQc` = a person publishes despite failed quality checks (audited). */
export const POST = api<{ params: Promise<{ id: string }> }>('publish:now', async (req, { params, user }) => {
  const { overrideQc, reason } = Body.parse(await req.json().catch(() => ({})));
  const job = await publishNow((await params).id, { id: user.sub, email: user.email }, { overrideQc, reason });
  return NextResponse.json({ ok: true, publicationJobId: job.id, state: job.state, scheduledFor: job.scheduledFor });
});
