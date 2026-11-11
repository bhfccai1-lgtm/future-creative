import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { competitorReport } from '@/lib/competitors/service';
/** GET ?brand=<Metricool blogId> — competitor benchmark & content intelligence. */
export const GET = api('dashboard:view', async (req) => {
  const brand = new URL(req.url).searchParams.get('brand');
  if (!brand) return NextResponse.json({ error: 'VALIDATION', message: 'brand مطلوب' }, { status: 422 });
  return NextResponse.json(await competitorReport(brand));
});
