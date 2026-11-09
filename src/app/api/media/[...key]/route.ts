import { contentTypeFor, storage } from '@/lib/storage';
import { api } from '@/lib/auth/server';
export const dynamic = 'force-dynamic';
/** Authenticated media access for the dashboard. */
export const GET = api<{ params: Promise<{ key: string[] }> }>('dashboard:view', async (_req, { params }) => {
  const key = (await params).key.join('/');
  if (key.includes('..')) return new Response('Bad key', { status: 400 });
  try {
    const buf = await storage().get(key);
    return new Response(new Uint8Array(buf), { headers: { 'Content-Type': contentTypeFor(key), 'Cache-Control': 'private, max-age=600' } });
  } catch { return new Response('Not found', { status: 404 }); }
});
