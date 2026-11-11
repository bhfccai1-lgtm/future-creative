import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { prisma } from '@/lib/db';
import { emitEvent, deliverPending } from '@/lib/integrations/events';
import { AppError } from '@/lib/errors';

/** Sends a signed test.ping to the configured n8n webhook right now and reports the HTTP result. */
export const POST = api('settings:integrations', async (_req, { user }) => {
  const d = await emitEvent('test.ping', { by: user.email, message: 'اختبار ربط n8n من مطبعة إبداع المستقبل' });
  if (!d) throw new AppError('NOT_CONFIGURED', 'فعّل n8n وأدخل رابط Webhook أولًا.', 412);
  await deliverPending();
  const r = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: d.id } });
  return NextResponse.json({ status: r.status, httpStatus: r.lastStatus, error: r.lastError });
});
