import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { importCompetitors } from '@/lib/competitors/service';
import { audit } from '@/lib/audit';
const Body = z.object({ brandId: z.string().regex(/^\d+$/) });
/** Read-only pull of competitor data from Metricool for one brand. */
export const POST = api('settings:integrations', async (req, { user }) => {
  const { brandId } = Body.parse(await req.json());
  const r = await importCompetitors(brandId);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'competitors.refresh', details: { brandId, result: r as Record<string, string> } });
  const msg = (r as Record<string, string>)[brandId];
  return NextResponse.json({ ok: !!msg && !msg.startsWith('ERROR'), message: msg ?? 'لا توجد نتيجة' });
});
