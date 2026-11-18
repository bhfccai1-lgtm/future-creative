import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { getSettings, updateSettings } from '@/lib/settings';
import { audit } from '@/lib/audit';
export const GET = api('ads:create', async () => NextResponse.json({ ok: true, print: (await getSettings()).print }));
/** the shop's real capabilities (products / materials / finishes / methods it does NOT offer, PDF/X, ICC) */
export const PUT = api('settings:ai', async (req, { user }) => {
  const body = z.object({ disabledProducts: z.array(z.string().max(40)).max(300), disabledMaterials: z.array(z.string().max(40)).max(200), disabledFinishes: z.array(z.string().max(40)).max(200), disabledMethods: z.array(z.string().max(40)).max(100), pdfx: z.enum(['none', 'x1a', 'x4']), iccProfile: z.string().max(120).regex(/^[\w.-]*$/) }).partial().parse(await req.json());
  const s = await updateSettings((cur) => ({ ...cur, print: { ...cur.print, ...body } }), user.email);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'print.capabilities', details: body });
  return NextResponse.json({ ok: true, print: s.print });
});
