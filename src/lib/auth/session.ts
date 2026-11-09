import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE = 'fc_session';
export const CSRF_COOKIE = 'fc_csrf';
export const SESSION_TTL_SECONDS = 12 * 3600;

export interface SessionClaims { sub: string; email: string; role: string; perms: string[]; sv: number; }

const key = () => new TextEncoder().encode(process.env.SESSION_SECRET ?? '');

export async function signSession(c: SessionClaims): Promise<string> {
  return new SignJWT({ email: c.email, role: c.role, perms: c.perms, sv: c.sv })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(c.sub).setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`).setIssuer('future-creative').sign(key());
}

export async function verifySession(token: string | undefined | null): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { issuer: 'future-creative', algorithms: ['HS256'] });
    return { sub: String(payload.sub), email: String(payload.email), role: String(payload.role), perms: (payload.perms as string[]) ?? [], sv: Number(payload.sv ?? 0) };
  } catch { return null; }
}

export const cookieSecure = () => (process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production');
