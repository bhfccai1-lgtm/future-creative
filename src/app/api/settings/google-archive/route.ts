import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { getSecret, secretStatus, setSecret } from '@/lib/settings';
import { audit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { prisma } from '@/lib/db';

const Body = z.object({ url: z.string().max(500) });
/** Save (encrypted) the Apps Script web-app URL; "__delete__" removes it. */
export const PUT = api('settings:integrations', async (req, { user }) => {
  const { url } = Body.parse(await req.json());
  if (url === '__delete__') await setSecret('GOOGLE_ARCHIVE_URL', null, user.email);
  else {
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]{20,}\/exec$/.test(url.trim())) throw new AppError('VALIDATION', 'الرابط يجب أن يكون رابط تطبيق ويب من Apps Script وينتهي بـ /exec', 422);
    await setSecret('GOOGLE_ARCHIVE_URL', url.trim(), user.email);
  }
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'settings.google_archive.update', details: { configured: url !== '__delete__' } });
  return NextResponse.json({ configured: (await secretStatus('GOOGLE_ARCHIVE_URL')).configured });
});
/** Test: sends a test.ping straight to the script. Optionally archives the latest verified publication now (backfill one). */
export const POST = api('settings:integrations', async (req) => {
  const url = await getSecret('GOOGLE_ARCHIVE_URL');
  if (!url) throw new AppError('NOT_CONFIGURED', 'احفظ رابط السكربت أولًا.', 412);
  const { backfill } = z.object({ backfill: z.boolean().default(false) }).parse(await req.json().catch(() => ({})));
  if (backfill) {
    const { queueGoogleArchive } = await import('@/lib/integrations/google-archive');
    const jobs = await prisma.publicationJob.findMany({ where: { state: 'PUBLISHED', primary: true }, orderBy: { updatedAt: 'desc' }, take: 20, include: { result: true } });
    let n = 0;
    for (const j of jobs) if (await queueGoogleArchive(j.advertisementId, j.result?.publicUrl ?? null)) n++;
    return NextResponse.json({ ok: true, queued: n });
  }
  let r: Response;
  try { r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: 'test.ping' }), signal: AbortSignal.timeout(20_000) }); }
  catch (e) { throw new AppError('NETWORK', `تعذر الوصول للسكربت: ${(e as Error).message}`, 502); }
  const j = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!r.ok || !j?.ok) throw new AppError('SCRIPT', !j ? 'السكربت لم يرجع JSON — تأكد أن النشر «Web app» و«Who has access: Anyone».' : `السكربت رد بخطأ: ${j.error ?? r.status}`, 502);
  return NextResponse.json({ ok: true });
});
