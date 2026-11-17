import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { updateSettings } from '@/lib/settings';
import { audit } from '@/lib/audit';
import { OCCASIONS } from '@/lib/creative/options';

/** Switch an occasion off (never picked automatically) or back on. */
export const POST = api('automation:control', async (req, { user }) => {
  const { key, enabled } = z.object({ key: z.string().refine((k) => OCCASIONS.some((o) => o.value === k), 'مناسبة غير معروفة'), enabled: z.boolean() }).parse(await req.json());
  const s = await updateSettings((x) => ({ ...x, disabledOccasions: enabled ? x.disabledOccasions.filter((k) => k !== key) : [...new Set([...x.disabledOccasions, key])] }), user.email);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'occasions.toggle', details: { key, enabled } });
  return NextResponse.json({ disabled: s.disabledOccasions });
});
