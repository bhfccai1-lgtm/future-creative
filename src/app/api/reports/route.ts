import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { buildReport } from '@/lib/analytics/report';

/** GET /api/reports?period=week|month&account=<id> — verified-only performance report (JSON). */
export const GET = api('dashboard:view', async (req) => {
  const u = new URL(req.url);
  const period = u.searchParams.get('period') === 'month' ? 'month' : 'week';
  return NextResponse.json(await buildReport(period, u.searchParams.get('account') || undefined));
});
