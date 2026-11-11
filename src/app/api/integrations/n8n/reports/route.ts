import { NextResponse } from 'next/server';
import { integrationApi } from '@/lib/integrations/auth';
import { buildReport } from '@/lib/analytics/report';
/** GET ?period=week|month&account=<id> — verified-only performance report. */
export const GET = integrationApi(async (req) => {
  const u = new URL(req.url);
  return NextResponse.json(await buildReport(u.searchParams.get('period') === 'month' ? 'month' : 'week', u.searchParams.get('account') || undefined));
});
