import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { audit } from '@/lib/audit';
import { getAdapter } from '@/lib/publishing/registry';
import { verifyConnections } from '@/lib/publishing/health';

export const POST = api('accounts:manage', async (_req, { user }) => {
  const r = await verifyConnections(await getAdapter('metricool'));
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'account.verify_all', details: r });
  return NextResponse.json(r);
});
