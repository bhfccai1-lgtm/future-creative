import { NextResponse } from 'next/server';
import { createHmac } from 'node:crypto';
import { safeEqual } from '@/lib/crypto';
import { prisma } from '@/lib/db';
import { reconcileJob } from '@/lib/publishing/reconcile';
import { rateLimit } from '@/lib/security/rate-limit';

/**
 * Generic signed webhook (e.g. from an automation relay). Signature: hex HMAC-SHA256 of the raw body
 * with WEBHOOK_SECRET in header `x-fc-signature`, plus `x-fc-timestamp` within 5 minutes.
 * The payload is NEVER trusted as proof of publication: it only triggers reconciliation with the provider.
 */
export async function POST(req: Request) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'webhooks disabled' }, { status: 404 });
  const rl = await rateLimit('webhook', 120, 60);
  if (!rl.ok) return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  const raw = await req.text();
  const ts = req.headers.get('x-fc-timestamp') ?? '';
  const sig = req.headers.get('x-fc-signature') ?? '';
  if (!/^\d+$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return NextResponse.json({ error: 'stale' }, { status: 401 });
  const expected = createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex');
  if (!safeEqual(expected, sig)) return NextResponse.json({ error: 'bad signature' }, { status: 401 });
  let body: { providerPostId?: string };
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  if (!body.providerPostId) return NextResponse.json({ ok: true, matched: 0 });
  const res = await prisma.publicationResult.findFirst({ where: { providerPostId: String(body.providerPostId) } });
  if (!res) return NextResponse.json({ ok: true, matched: 0 });
  const outcome = await reconcileJob(res.jobId);
  return NextResponse.json({ ok: true, matched: 1, outcome });
}
