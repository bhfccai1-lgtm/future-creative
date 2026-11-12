import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { updateSettings } from '@/lib/settings';
import { audit } from '@/lib/audit';
import { boostWinners } from '@/lib/growth/winners';
import { growthStatus } from '@/lib/growth/status';

export const GET = api('automation:control', async () => NextResponse.json(await growthStatus()));

const Body = z.object({
  peakHours: z.object({ enabled: z.boolean(), maxDelayHours: z.number().int().min(1).max(6), count: z.number().int().min(2).max(10) }),
  winners: z.object({ enabled: z.boolean(), minMultiple: z.number().min(1.2).max(10), maxPerWeek: z.number().int().min(1).max(14) }),
});
export const PUT = api('automation:control', async (req, { user }) => {
  const b = Body.parse(await req.json());
  await updateSettings((s) => ({ ...s, growth: b }), user.email);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'settings.growth', details: { peak: b.peakHours.enabled, winners: b.winners.enabled } });
  return NextResponse.json(await growthStatus());
});
/** Boost winners now (respects the weekly cap; works even when the weekly automation is off). */
export const POST = api('automation:control', async (_req, { user }) => {
  const r = await boostWinners({ force: true, actor: user.email });
  return NextResponse.json({ ...r, status: await growthStatus() });
});
