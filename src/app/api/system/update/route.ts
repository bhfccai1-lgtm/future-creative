import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { audit } from '@/lib/audit';
import { requestServerUpdate, serverUpdateState, UpdateBusyError } from '@/lib/ops/server-update';
export const dynamic = 'force-dynamic';

/** Status of the «update the server» button (version, host agent, pending request, last result). */
export const GET = api('settings:integrations', async () => NextResponse.json(await serverUpdateState()));

/** Asks the host update agent to install the latest version (GitHub CI must be green; automatic rollback on failure). */
export const POST = api('settings:integrations', async (_req, { user }) => {
  try {
    const req = await requestServerUpdate(user.email);
    await audit({ actorId: user.sub, actorLabel: user.email, action: 'system.update_requested', targetType: 'system', targetId: 'server', details: { from: process.env.APP_VERSION ?? 'dev' } });
    return NextResponse.json({ ok: true, request: req, state: await serverUpdateState() }, { status: 202 });
  } catch (e) {
    if (e instanceof UpdateBusyError) return NextResponse.json({ error: 'BUSY', message: 'يوجد تحديث يعمل الآن — انتظر حتى ينتهي' }, { status: 409 });
    throw e;
  }
});
