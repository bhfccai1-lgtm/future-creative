import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';
import { deliverPending } from '@/lib/integrations/events';

const Body = z.object({ id: z.string().optional(), allDead: z.boolean().optional() });
/** Re-queues one failed (DEAD) event, or all of them, and delivers immediately. The payload and its delivery id stay the same, so n8n can de-duplicate. */
export const POST = api('settings:integrations', async (req, { user }) => {
  const b = Body.parse(await req.json());
  const where = b.id ? { id: b.id, status: { in: ['DEAD', 'PENDING'] } } : { status: 'DEAD', createdAt: { gte: new Date(Date.now() - 7 * 86400_000) } };
  const r = await prisma.webhookDelivery.updateMany({ where, data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lastError: null } });
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'settings.n8n.redeliver', details: { id: b.id ?? null, requeued: r.count } });
  const d = await deliverPending();
  return NextResponse.json({ requeued: r.count, ...d });
});
