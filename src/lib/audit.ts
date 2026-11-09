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

export async function notify(level: NotificationLevel, code: string, title: string, message: string, accountId?: string) {
  // de-duplicate identical unread notifications within one hour
  const since = new Date(Date.now() - 3600_000);
  const exists = await prisma.notification.findFirst({ where: { code, accountId: accountId ?? null, readAt: null, createdAt: { gte: since } } });
  if (exists) return exists;
  return prisma.notification.create({ data: { level, code, title, message, accountId } });
}
