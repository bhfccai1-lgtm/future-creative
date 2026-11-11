import { NextResponse } from 'next/server';
import { integrationApi } from '@/lib/integrations/auth';
import { competitorReport, linkedBrands } from '@/lib/competitors/service';
/** GET ?brand=<blogId> — competitor report; without brand: list of linked brands. */
export const GET = integrationApi(async (req) => {
  const brand = new URL(req.url).searchParams.get('brand');
  return NextResponse.json(brand ? await competitorReport(brand) : await linkedBrands());
});
