import sharp from 'sharp';
import { prisma } from '@/lib/db';
import { api } from '@/lib/auth/server';
import { storage } from '@/lib/storage';

export const dynamic = 'force-dynamic';
/** STEP 08 — export the final design as a lossless PNG (default) or the published JPEG, at its exact output size. */
export const GET = api<{ params: Promise<{ id: string }> }>('dashboard:view', async (req, { params }) => {
  const { id } = await params;
  const fmt = new URL(req.url).searchParams.get('format') === 'jpg' ? 'jpg' : 'png';
  const ad = await prisma.advertisement.findUnique({ where: { id }, select: { id: true, format: true, media: { where: { role: 'FINAL' }, take: 1, select: { storageKey: true, width: true, height: true } } } });
  const m = ad?.media[0];
  if (!m) return new Response('Not found', { status: 404 });
  const src = await storage().get(m.storageKey);
  // PNG: the lossless master saved at generation (older designs: converted from the final JPEG)
  const masterKey = m.storageKey.replace(/final\.jpg$/, 'final.png');
  const out = fmt === 'jpg' ? src : (masterKey !== m.storageKey && await storage().exists(masterKey)) ? await storage().get(masterKey) : await sharp(src).png({ compressionLevel: 9 }).toBuffer();
  const meta = await sharp(out).metadata();
  return new Response(new Uint8Array(out), { headers: {
    'Content-Type': fmt === 'png' ? 'image/png' : 'image/jpeg',
    'Content-Disposition': `attachment; filename="future-creative-${id.slice(-8)}-${meta.width}x${meta.height}.${fmt}"`,
    'Cache-Control': 'private, no-store',
  } });
});
