import { contentTypeFor, storage, verifyMediaSignature } from '@/lib/storage';
export const dynamic = 'force-dynamic';
/** Signed, expiring media URLs used by publishing providers to fetch finished ads. Only ads/ keys are served. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const k = u.searchParams.get('k') ?? '', e = u.searchParams.get('e') ?? '', s = u.searchParams.get('s') ?? '';
  if (!k.startsWith('ads/') || k.includes('..') || !verifyMediaSignature(k, e, s)) return new Response('Forbidden', { status: 403 });
  try {
    const buf = await storage().get(k);
    return new Response(new Uint8Array(buf), { headers: { 'Content-Type': contentTypeFor(k), 'Content-Length': String(buf.length), 'Cache-Control': 'private, max-age=3600' } });
  } catch { return new Response('Not found', { status: 404 }); }
}
