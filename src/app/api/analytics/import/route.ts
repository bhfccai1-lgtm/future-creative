import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { getAdapter } from '@/lib/publishing/registry';
import { importMetrics } from '@/lib/analytics/import';
import { audit } from '@/lib/audit';

/** Manual trigger for the read-only Metricool analytics import (also runs nightly in the worker). */
export const POST = api('settings:integrations', async (_req, { user }) => {
  const r = await importMetrics(await getAdapter('metricool'), { minAgeH: 1 });
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'analytics.import.manual', details: { updated: 'updated' in r ? r.updated : 0 } });
  return NextResponse.json(r);
});
