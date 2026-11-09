import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { redis } from '@/lib/queue/connection';
export const dynamic = 'force-dynamic';
export async function GET() {
  const checks: Record<string, string> = {};
  try { await prisma.$queryRaw`SELECT 1`; checks.db = 'ok'; } catch { checks.db = 'down'; }
  try { checks.redis = (await redis().ping()) === 'PONG' ? 'ok' : 'down'; } catch { checks.redis = 'down'; }
  const ok = Object.values(checks).every((v) => v === 'ok');
  return NextResponse.json({ ok, checks }, { status: ok ? 200 : 503 });
}
