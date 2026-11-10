import { contentTypeFor, storage, verifyMediaSignature } from '@/lib/storage';
export const dynamic = 'force-dynamic';

/** /api/m/<exp>/<sig>/<key…> — signed, expiring media for publishing providers (only ads/ keys). Supports HEAD + Range for video. */
async function serve(req: Request, params: Promise<{ p: string[] }>, head = false) {
  const [exp, sig, ...rest] = (await params).p;
  const key = rest.map(decodeURIComponent).join('/');
  if (!exp || !sig || !key.startsWith('ads/') || key.includes('..') || !verifyMediaSignature(key, exp, sig)) return new Response('Forbidden', { status: 403 });
  let buf: Buffer;
  try { buf = await storage().get(key); } catch { return new Response('Not found', { status: 404 }); }
  const base = { 'Content-Type': contentTypeFor(key), 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=3600' };
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') ?? '');
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), buf.length - 1) : buf.length - 1;
    if (start > end || start >= buf.length) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${buf.length}` } });
    const part = buf.subarray(start, end + 1);
    return new Response(head ? null : new Uint8Array(part), { status: 206, headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${buf.length}`, 'Content-Length': String(part.length) } });
  }
  return new Response(head ? null : new Uint8Array(buf), { headers: { ...base, 'Content-Length': String(buf.length) } });
}
export const GET = (req: Request, ctx: { params: Promise<{ p: string[] }> }) => serve(req, ctx.params);
export const HEAD = (req: Request, ctx: { params: Promise<{ p: string[] }> }) => serve(req, ctx.params, true);
