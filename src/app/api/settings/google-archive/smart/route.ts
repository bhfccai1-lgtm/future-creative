import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { audit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { curateBest, monthlyReport, syncMetricsToDrive } from '@/lib/integrations/drive-smart';

/** run the smart-Drive steps now: «sync» (performance sheet + best designs) or «report» (the monthly Google Doc) */
export const POST = api('settings:integrations', async (req, { user }) => {
  const { action } = z.object({ action: z.enum(['sync', 'report']) }).parse(await req.json());
  try {
    const r = action === 'sync' ? { metrics: await syncMetricsToDrive(), best: await curateBest() } : await monthlyReport();
    await audit({ actorId: user.sub, actorLabel: user.email, action: `drive.smart.${action}`, details: JSON.parse(JSON.stringify(r)) });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) { throw new AppError('DRIVE', (e as Error).message, 502); }
});
