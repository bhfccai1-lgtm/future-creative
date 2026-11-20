import { prisma } from '@/lib/db';
import { contentTypeFor, storage } from '@/lib/storage';
import { productImages } from '@/lib/integrations/whatsapp-catalog';

/** a permanent public image for a product page (Google Images, link previews) — only the product's own finished design */
export const dynamic = 'force-dynamic';
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const p = await prisma.product.findUnique({ where: { slug: (await params).slug }, select: { id: true, active: true } });
  if (!p?.active) return new Response('Not found', { status: 404 });
  const key = (await productImages([p.id])).get(p.id);
  if (!key) return new Response('Not found', { status: 404 });
  try {
    const buf = await storage().get(key);
    return new Response(new Uint8Array(buf), { headers: { 'Content-Type': contentTypeFor(key), 'Cache-Control': 'public, max-age=86400' } });
  } catch { return new Response('Not found', { status: 404 }); }
}
