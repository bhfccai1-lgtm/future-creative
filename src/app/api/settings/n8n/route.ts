import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { getSettings, secretStatus, updateSettings } from '@/lib/settings';
import { audit } from '@/lib/audit';
import { EVENTS } from '@/lib/integrations/events';

const Body = z.object({
  enabled: z.boolean(),
  webhookUrl: z.string().max(500).refine((u) => u === '' || /^https?:\/\/[^\s]+$/.test(u), 'رابط غير صالح'),
  events: z.array(z.enum(Object.keys(EVENTS) as [string, ...string[]])).max(20),
  allowInboundApprovals: z.boolean(),
  allowInboundGeneration: z.boolean(),
});
const status = async () => ({ secret: (await secretStatus('N8N_WEBHOOK_SECRET')).configured, token: (await secretStatus('N8N_API_TOKEN')).configured });

export const GET = api('settings:integrations', async () => NextResponse.json({ n8n: (await getSettings()).n8n, ...(await status()) }));
export const PUT = api('settings:integrations', async (req, { user }) => {
  const b = Body.parse(await req.json());
  const s = await updateSettings((x) => ({ ...x, n8n: { ...x.n8n, ...b } }), user.email);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'settings.n8n.update', details: { enabled: b.enabled, events: b.events, approvals: b.allowInboundApprovals, generation: b.allowInboundGeneration } });
  return NextResponse.json({ n8n: s.n8n, ...(await status()) });
});
