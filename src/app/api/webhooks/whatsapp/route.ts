import { NextResponse } from 'next/server';
import { getSecret } from '@/lib/settings';
import { safeEqual } from '@/lib/crypto';
import { handleInbound, verifyMetaSignature } from '@/lib/integrations/whatsapp-cloud';
import { log } from '@/lib/ops/log';
export const dynamic = 'force-dynamic';

/** Meta webhook verification: echoes hub.challenge when the verify token matches */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const token = await getSecret('WA_VERIFY_TOKEN');
  if (q.get('hub.mode') === 'subscribe' && token && safeEqual(q.get('hub.verify_token') ?? '', token)) return new Response(q.get('hub.challenge') ?? '', { status: 200 });
  return new Response('Forbidden', { status: 403 });
}

/** incoming messages — signed by Meta with the app secret (X-Hub-Signature-256); anything unsigned is refused */
export async function POST(req: Request) {
  const raw = await req.text();
  const secret = await getSecret('WA_APP_SECRET');
  if (!secret || !verifyMetaSignature(raw, req.headers.get('x-hub-signature-256'), secret)) return new Response('Forbidden', { status: 403 });
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return new Response('Bad JSON', { status: 400 }); }
  try { await handleInbound(payload); } catch (e) { log.warn('wa.webhook_failed', { error: (e as Error).message }); }
  return NextResponse.json({ ok: true }); // always 200 once verified, so Meta does not retry what was handled
}
