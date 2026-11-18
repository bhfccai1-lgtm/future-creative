import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { updateSettings } from '@/lib/settings';
import { audit } from '@/lib/audit';

const Body = z.object({
  monthlyTargetBhd: z.coerce.number().min(0).max(10_000_000).optional(), quoteValidityDays: z.coerce.number().int().min(1).max(90).optional(),
  quoteTerms: z.string().max(600).optional(), reactivationDays: z.coerce.number().int().min(14).max(365).optional(),
});
export const PUT = api('accounts:manage', async (req, { user }) => {
  const b = Body.parse(await req.json());
  const s = await updateSettings((x) => ({ ...x, sales: { ...x.sales, ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) } }), user.email);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'settings.sales.update', details: b });
  return NextResponse.json({ ok: true, sales: s.sales, message: 'حُفظت إعدادات المبيعات ✓' });
});
