import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { updateSettings } from '@/lib/settings';
import { audit } from '@/lib/audit';

const Body = z.object({ weekly: z.boolean(), perAccount: z.number().int().min(1).max(6), useBank: z.boolean(), autoApproveMinScore: z.number().min(0).max(10) });
export const PUT = api('automation:control', async (req, { user }) => {
  const b = Body.parse(await req.json());
  const s = await updateSettings((x) => ({ ...x, ideas: b }), user.email);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'settings.ideas', details: b });
  return NextResponse.json({ ok: true, ideas: s.ideas });
});
