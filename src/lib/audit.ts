import { prisma } from './db';
import type { NotificationLevel, Prisma } from '@prisma/client';

export async function audit(params: {
  actorId?: string | null; actorLabel: string; action: string;
  targetType?: string; targetId?: string; details?: Prisma.InputJsonValue; ip?: string | null;
}) {
  await prisma.auditLog.create({
    data: {
      actorId: params.actorId ?? null, actorLabel: params.actorLabel, action: params.action,
      targetType: params.targetType, targetId: params.targetId, details: params.details, ip: params.ip ?? null,
    },
  });
}

const DEDICATED = new Set(['PUBLISH_FAILED', 'PUBLISH_UNKNOWN', 'PUBLISH_NEEDS_OPERATOR', 'PROVIDER_ERROR', 'CONNECTION_LOST']);
const INFO_BRIDGED = new Set(['CAMPAIGN_DONE', 'CONNECTION_RESTORED', 'ACCOUNT_RESUMED']);

export async function notify(level: NotificationLevel, code: string, title: string, message: string, accountId?: string) {
  // de-duplicate identical unread notifications within one hour
  const since = new Date(Date.now() - 3600_000);
  const exists = await prisma.notification.findFirst({ where: { code, accountId: accountId ?? null, readAt: null, createdAt: { gte: since } } });
  if (exists) return exists;
  const n = await prisma.notification.create({ data: { level, code, title, message, accountId } });
  // Bridge to n8n: every NEW warning/error (and a few useful infos) becomes a `system.alert` event,
  // except codes that already have a dedicated event (avoids double messages).
  if ((level !== 'INFO' || INFO_BRIDGED.has(code)) && !DEDICATED.has(code)) {
    const { emitEvent } = await import('./integrations/events');
    await emitEvent('system.alert', { level, code, title, message, accountId: accountId ?? null });
  }
  return n;
}
