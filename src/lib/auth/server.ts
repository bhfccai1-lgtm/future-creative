import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { prisma } from '../db';
import { SESSION_COOKIE, verifySession, type SessionClaims } from './session';
import { can, type Permission } from './rbac';
import { AppError } from '../errors';
import { ZodError } from 'zod';

/** Verifies JWT *and* that the user still exists, is active, and the session version is current. */
export async function currentUser(): Promise<SessionClaims | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const claims = await verifySession(token);
  if (!claims) return null;
  const u = await prisma.user.findUnique({ where: { id: claims.sub }, include: { role: true } });
  if (!u || !u.active || u.sessionVersion !== claims.sv) return null;
  return { ...claims, role: u.role.name, perms: u.role.permissions };
}

export async function requirePageUser(perm: Permission = 'dashboard:view') {
  const u = await currentUser();
  if (!u) redirect('/login');
  if (!can(u.perms, perm)) redirect('/?denied=1');
  return u;
}

export async function clientIp() {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null;
}

type Handler<C> = (req: Request, ctx: C & { user: SessionClaims }) => Promise<Response>;

/** Wraps an API route: authentication, permission check, uniform error handling. CSRF is enforced in middleware. */
export function api<C = { params: Promise<Record<string, string>> }>(perm: Permission, handler: Handler<C>) {
  return async (req: Request, ctx: C) => {
    try {
      const user = await currentUser();
      if (!user) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
      if (!can(user.perms, perm)) return NextResponse.json({ error: 'FORBIDDEN', message: 'لا تملك الصلاحية' }, { status: 403 });
      return await handler(req, { ...ctx, user });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function errorResponse(e: unknown) {
  if (e instanceof AppError) return NextResponse.json({ error: e.code, message: e.message, details: e.details }, { status: e.status });
  if (e instanceof ZodError) return NextResponse.json({ error: 'VALIDATION', message: 'بيانات غير صالحة', details: e.issues }, { status: 422 });
  console.error('[api] unhandled', e);
  return NextResponse.json({ error: 'INTERNAL', message: 'خطأ داخلي في الخادم' }, { status: 500 });
}
