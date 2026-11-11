import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { integrationApi } from '@/lib/integrations/auth';
/** GET — accounts with connection/publishing status (no secrets). */
export const GET = integrationApi(async () => {
  const rows = await prisma.socialAccount.findMany({ include: { connection: true }, orderBy: { name: 'asc' } });
  return NextResponse.json(rows.map((a) => ({ id: a.id, name: a.name, handle: a.handle, platform: a.platform, language: a.language, format: a.publishFormat, formatStrategy: a.formatStrategy, everyHours: a.publishIntervalMinutes / 60, connected: a.connection?.status === 'CONNECTED' && !!a.connection.canPublish, autoPublish: a.autoPublishEnabled, autonomous: a.autonomousAuthorized, paused: a.paused, nextPublishAt: a.nextPublishAt })));
});
