import { redis } from '../queue/connection';

/**
 * Fixed-window rate limiter backed by Redis (shared across web + worker instances).
 * Falls back to an in-process map if Redis is unavailable so login protection never silently disappears.
 */
const local = new Map<string, { n: number; reset: number }>();

export async function rateLimit(key: string, limit: number, windowSec: number): Promise<{ ok: boolean; remaining: number; retryAfterSec: number }> {
  const bucket = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSec)}`;
  try {
    const r = redis();
    const n = await r.incr(bucket);
    if (n === 1) await r.expire(bucket, windowSec);
    const ttl = await r.ttl(bucket);
    return { ok: n <= limit, remaining: Math.max(0, limit - n), retryAfterSec: ttl > 0 ? ttl : windowSec };
  } catch {
    const now = Date.now();
    const e = local.get(bucket) ?? { n: 0, reset: now + windowSec * 1000 };
    e.n++; local.set(bucket, e);
    return { ok: e.n <= limit, remaining: Math.max(0, limit - e.n), retryAfterSec: Math.ceil((e.reset - now) / 1000) };
  }
}
