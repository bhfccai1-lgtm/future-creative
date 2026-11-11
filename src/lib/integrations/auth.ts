import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSecret, getSettings, type Settings } from '../settings';
import { errorResponse } from '../auth/server';
import { rateLimit } from '../security/rate-limit';
import { AppError } from '../errors';

const h = (s: string) => createHash('sha256').update(s).digest();

/** Constant-time bearer check against the encrypted N8N_API_TOKEN. */
export async function verifyIntegrationToken(header: string | null): Promise<boolean> {
  const token = await getSecret('N8N_API_TOKEN');
  const given = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token || !given) return false;
  return timingSafeEqual(h(given), h(token));
}

type Handler<C> = (req: Request, ctx: C & { settings: Settings }) => Promise<Response>;
/**
 * Wrapper for n8n-facing routes: integration enabled + valid bearer token + rate limit (120/min).
 * These routes are cookie-less (no CSRF surface) and act as the actor "n8n" in the audit log.
 */
export function integrationApi<C = unknown>(handler: Handler<C>) {
  return async (req: Request, ctx: C) => {
    try {
      const settings = await getSettings();
      if (!settings.n8n.enabled) return NextResponse.json({ error: 'DISABLED', message: 'تكامل n8n غير مفعّل.' }, { status: 403 });
      if (!(await verifyIntegrationToken(req.headers.get('authorization')))) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
      const rl = await rateLimit('n8n:api', 120, 60);
      if (!rl.ok) throw new AppError('RATE_LIMITED', 'تم تجاوز حد الطلبات.', 429);
      return await handler(req, { ...ctx, settings });
    } catch (e) { return errorResponse(e); }
  };
}

/**
 * Idempotency for n8n retries: the same `Idempotency-Key` header returns the first response (24 h) instead of
 * creating a second design/decision. A concurrent duplicate gets 409 while the first is still running.
 */
export async function withIdempotency(req: Request, scope: string, fn: () => Promise<Response>): Promise<Response> {
  const key = req.headers.get('idempotency-key')?.trim();
  if (!key) return fn();
  if (key.length > 200) throw new AppError('VALIDATION', 'Idempotency-Key طويل جدًا.', 422);
  const { redis } = await import('../queue/connection');
  const rk = `fc:idem:${scope}:${createHash('sha256').update(key).digest('hex')}`;
  const prev = await redis().get(rk);
  if (prev && prev !== 'pending') { const p = JSON.parse(prev) as { status: number; body: unknown }; return NextResponse.json(p.body, { status: p.status, headers: { 'Idempotent-Replay': 'true' } }); }
  if (prev === 'pending' || !(await redis().set(rk, 'pending', 'EX', 120, 'NX'))) return NextResponse.json({ error: 'IN_PROGRESS', message: 'طلب بنفس المفتاح قيد التنفيذ.' }, { status: 409 });
  try {
    const res = await fn();
    const body = await res.clone().json().catch(() => null);
    if (res.status < 500) await redis().set(rk, JSON.stringify({ status: res.status, body }), 'EX', 86400);
    else await redis().del(rk);
    return res;
  } catch (e) { await redis().del(rk); throw e; }
}
