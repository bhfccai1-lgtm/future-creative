import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { getSettings, secretStatus, setSecret, updateSettings } from '@/lib/settings';
import { audit } from '@/lib/audit';

const Body = z.object({ token: z.string().max(400).optional(), userId: z.string().regex(/^\d*$/).max(30), baseUrl: z.string().url(), requestsPerMinute: z.number().int().min(1).max(600) });

export const GET = api('settings:integrations', async () => {
  const s = await getSettings();
  return NextResponse.json({ metricool: s.metricool, token: await secretStatus('METRICOOL_API_TOKEN') });
});
export const PUT = api('settings:integrations', async (req, { user }) => {
  const { token, ...m } = Body.parse(await req.json());
  if (token === '__delete__') await setSecret('METRICOOL_API_TOKEN', null, user.email);
  else if (token) await setSecret('METRICOOL_API_TOKEN', token.trim(), user.email);
  const s = await updateSettings((x) => ({ ...x, metricool: { ...x.metricool, ...m } }), user.email);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'settings.integrations.update', details: { tokenChanged: !!token, userId: m.userId } });
  return NextResponse.json({ metricool: s.metricool, token: await secretStatus('METRICOOL_API_TOKEN') });
});
