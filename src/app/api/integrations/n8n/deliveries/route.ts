import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { integrationApi } from '@/lib/integrations/auth';

/** GET ?since=<ISO>&event=<name>&limit=100 — event log for catch-up after n8n downtime (payloads as sent). */
export const GET = integrationApi(async (req) => {
  const u = new URL(req.url);
  const since = u.searchParams.get('since');
  const rows = await prisma.webhookDelivery.findMany({
    where: { ...(since && !Number.isNaN(Date.parse(since)) ? { createdAt: { gte: new Date(since) } } : {}), ...(u.searchParams.get('event') ? { event: u.searchParams.get('event')! } : {}) },
    orderBy: { createdAt: 'asc' }, take: Math.min(500, Math.max(1, Number(u.searchParams.get('limit')) || 100)),
  });
  return NextResponse.json(rows.map((r) => ({ deliveryId: r.id, event: r.event, status: r.status, attempts: r.attempts, createdAt: r.createdAt, payload: r.payload })));
});
