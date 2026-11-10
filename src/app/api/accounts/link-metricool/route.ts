import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { audit } from '@/lib/audit';
import { getAdapter } from '@/lib/publishing/registry';
import { linkAllBrands } from '@/lib/publishing/link';

/** One-click: link every Metricool brand to an account (verified against Metricool's own brand list). */
export const POST = api('accounts:manage', async (_req, { user }) => {
  const result = await linkAllBrands(await getAdapter('metricool'));
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'account.link_all_metricool', details: { brands: result.length, linked: result.filter((r) => r.action !== 'skipped').length } });
  return NextResponse.json({ result });
});
