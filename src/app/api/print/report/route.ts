import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { currentMonth, printReport } from '@/lib/print/report';
export const dynamic = 'force-dynamic';
/** monthly print report (YYYY-MM, Bahrain time) */
export const GET = api('ads:create', async (req, { user }) => {
  const m = new URL(req.url).searchParams.get('month') ?? currentMonth();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) return NextResponse.json({ error: 'INVALID', message: 'الشهر بصيغة YYYY-MM' }, { status: 422 });
  return NextResponse.json({ ok: true, report: await printReport(m, user.perms.includes('users:manage') ? null : user.email) });
});
