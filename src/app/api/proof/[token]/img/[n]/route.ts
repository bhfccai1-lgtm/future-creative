import { proofImage } from '@/lib/print/proof';
import type { AppError } from '@/lib/errors';
type P = { params: Promise<{ token: string; n: string }> };
export const dynamic = 'force-dynamic';
/** PUBLIC: a watermarked proof image (only the ones belonging to this link, only while it is valid) */
export async function GET(_req: Request, { params }: P) {
  const { token, n } = await params;
  try { const buf = await proofImage(token, Number(n) || 0); return new Response(new Uint8Array(buf), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=300', 'X-Robots-Tag': 'noindex' } }); }
  catch (e) { return new Response((e as AppError).message ?? 'Not found', { status: (e as AppError).status ?? 404 }); }
}
