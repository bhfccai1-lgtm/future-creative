import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/auth/password';

let dummyHash: Promise<string> | null = null; // constant-time path for unknown users
import { SESSION_COOKIE, SESSION_TTL_SECONDS, cookieSecure, signSession } from '@/lib/auth/session';
import { rateLimit } from '@/lib/security/rate-limit';
import { audit } from '@/lib/audit';
import { clientIp, errorResponse } from '@/lib/auth/server';

const Body = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });
const LOCK_AFTER = 5, LOCK_MINUTES = 15;

export async function POST(req: Request) {
  try {
    const ip = (await clientIp()) ?? 'unknown';
    const rl = await rateLimit(`login:${ip}`, 10, 300);
    if (!rl.ok) return NextResponse.json({ error: 'RATE_LIMITED', message: 'محاولات كثيرة، حاول لاحقًا.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } });
    const { email, password } = Body.parse(await req.json());
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() }, include: { role: true } });
    const generic = NextResponse.json({ error: 'INVALID_CREDENTIALS', message: 'البريد أو كلمة المرور غير صحيحة.' }, { status: 401 });
    if (!user || !user.active) { dummyHash ??= hashPassword('timing-equaliser'); await verifyPassword(password, await dummyHash); return generic; }
    if (user.lockedUntil && user.lockedUntil > new Date()) return NextResponse.json({ error: 'LOCKED', message: 'الحساب مقفل مؤقتًا بسبب محاولات فاشلة.' }, { status: 423 });
    if (!(await verifyPassword(password, user.passwordHash))) {
      const failed = user.failedLogins + 1;
      await prisma.user.update({ where: { id: user.id }, data: { failedLogins: failed, lockedUntil: failed >= LOCK_AFTER ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null } });
      await audit({ actorId: user.id, actorLabel: user.email, action: 'auth.login_failed', ip });
      return generic;
    }
    await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
    const token = await signSession({ sub: user.id, email: user.email, role: user.role.name, perms: user.role.permissions, sv: user.sessionVersion });
    await audit({ actorId: user.id, actorLabel: user.email, action: 'auth.login', ip });
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure: cookieSecure(), sameSite: 'strict', path: '/', maxAge: SESSION_TTL_SECONDS });
    return res;
  } catch (e) { return errorResponse(e); }
}
