import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';
import { getSettings, updateSettings } from '@/lib/settings';
import { AppError } from '@/lib/errors';
import { getSecret } from '@/lib/settings';

/** Google Drive cold storage: what is on Drive, what was freed on the server, and the switch. */
export const GET = api('settings:integrations', async () => {
  const rows = await prisma.mediaAsset.findMany({ where: { role: { in: ['FINAL', 'VIDEO', 'SLIDE'] } }, select: { bytes: true, meta: true } });
  let onDrive = 0, offloaded = 0, freed = 0, localBytes = 0;
  for (const r of rows) {
    const m = (r.meta as { drive?: { id?: string }; offloadedAt?: string } | null) ?? {};
    if (m.drive?.id) onDrive++;
    if (m.offloadedAt) { offloaded++; freed += r.bytes; } else localBytes += r.bytes;
  }
  const s = (await getSettings()).storage;
  return NextResponse.json({ settings: s, stats: { files: rows.length, onDrive, offloaded, freedMb: Math.round(freed / 1e6), localMb: Math.round(localBytes / 1e6) } });
});

const Body = z.object({ driveOffload: z.boolean(), offloadAfterDays: z.number().int().min(7).max(365), keepDriveBackups: z.number().int().min(3).max(365), driveSmart: z.boolean().optional() });
export const PUT = api('settings:integrations', async (req, { user }) => {
  const b = Body.parse(await req.json());
  if ((b.driveOffload || b.driveSmart) && !(await getSecret('GOOGLE_ARCHIVE_URL'))) throw new AppError('NOT_CONFIGURED', 'اربط أرشيف Google أولًا (رابط السكربت).', 412);
  const s = await updateSettings((x) => ({ ...x, storage: { ...x.storage, ...b } }), user.email);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'settings.storage.update', details: b });
  return NextResponse.json({ settings: s.storage });
});

/** «حرّر المساحة الآن»: runs the nightly offload immediately (same safety rules) */
export const POST = api('settings:integrations', async (_req, { user }) => {
  const st = (await getSettings()).storage;
  if (!st.driveOffload) throw new AppError('DISABLED', 'فعّل «نقل التصاميم القديمة إلى Drive» أولًا.', 409);
  const { offloadArchivedMedia } = await import('@/lib/integrations/google-archive');
  const r = await offloadArchivedMedia({ afterDays: st.offloadAfterDays });
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'storage.offload', details: { removed: r.removed, freedMb: Math.round(r.freedBytes / 1e6), skipped: r.skipped } });
  return NextResponse.json({ ok: true, ...r, freedMb: Math.round(r.freedBytes / 1e6) });
});
