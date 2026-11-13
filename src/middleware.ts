import { NextResponse, type NextRequest } from 'next/server';
import { CSRF_COOKIE, SESSION_COOKIE, verifySession, cookieSecure } from './lib/auth/session';

const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/health', '/api/public-media', '/api/m/', '/api/webhooks/', '/api/integrations/', '/p/', '/manifest.webmanifest', '/icons/'];

/**
 * Edge middleware:
 *  - redirects unauthenticated page requests to /login
 *  - enforces CSRF on every state-changing request (double-submit token + same-origin check)
 *  - issues the CSRF cookie
 * Full session validation (user active, session version) happens again server-side in each route.
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p));
  const method = req.method.toUpperCase();
  const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(method);

  // webhooks (HMAC) and integrations (bearer token) carry no cookies → no CSRF surface; they authenticate themselves
  if (mutating && !pathname.startsWith('/api/webhooks/') && !pathname.startsWith('/api/integrations/')) {
    const origin = req.headers.get('origin');
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
    if (origin && host && new URL(origin).host !== host) {
      return NextResponse.json({ error: 'CSRF', message: 'Cross-origin request blocked' }, { status: 403 });
    }
    const cookieTok = req.cookies.get(CSRF_COOKIE)?.value;
    const headerTok = req.headers.get('x-csrf-token');
    if (!cookieTok || !headerTok || cookieTok !== headerTok) {
      return NextResponse.json({ error: 'CSRF', message: 'Missing or invalid CSRF token' }, { status: 403 });
    }
  }

  let res: NextResponse;
  if (!isPublic) {
    const claims = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
    if (!claims) {
      if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
      const url = req.nextUrl.clone(); url.pathname = '/login'; url.search = '';
      res = NextResponse.redirect(url);
    } else res = NextResponse.next();
  } else res = NextResponse.next();

  if (!req.cookies.get(CSRF_COOKIE)) {
    const tok = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
    res.cookies.set(CSRF_COOKIE, tok, { httpOnly: false, sameSite: 'strict', secure: cookieSecure(), path: '/' });
  }
  return res;
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|fonts/).*)'] };
