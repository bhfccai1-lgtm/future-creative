import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { publishNow } from '@/lib/publishing/jobs';
/** "نشر الآن" — returns the queued job. The UI shows SCHEDULED/PUBLISHED only once the backend confirms it. */
export const POST = api<{ params: Promise<{ id: string }> }>('publish:now', async (_req, { params, user }) => {
  const job = await publishNow((await params).id, { id: user.sub, email: user.email });
  return NextResponse.json({ ok: true, publicationJobId: job.id, state: job.state, scheduledFor: job.scheduledFor });
});
