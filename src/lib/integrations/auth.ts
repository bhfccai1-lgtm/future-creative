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
