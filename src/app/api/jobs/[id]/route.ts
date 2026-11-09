import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { QUEUE, queue } from '@/lib/queue/queues';

export const GET = api<{ params: Promise<{ id: string }> }>('dashboard:view', async (_req, { params }) => {
  const { id } = await params;
  const job = await queue(QUEUE.generate).getJob(id);
  if (!job) return NextResponse.json({ state: 'not_found' }, { status: 404 });
  return NextResponse.json({ state: await job.getState(), result: job.returnvalue ?? null, failedReason: job.failedReason ?? null });
});
