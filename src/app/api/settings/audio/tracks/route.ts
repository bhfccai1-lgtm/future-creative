import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { addTrack } from '@/lib/audio/library';

export const GET = api('settings:ai', async () => NextResponse.json(await prisma.audioTrack.findMany({ orderBy: { createdAt: 'desc' } })));
/** multipart: file, mood, licenseNote (required), name?, startSec?, bpm?, confirm=1 (the owner confirms the licence). */
export const POST = api('settings:ai', async (req, { user }) => {
  const f = await req.formData();
  const file = f.get('file');
  if (!(file instanceof File) || !file.size) throw new AppError('VALIDATION', 'اختر ملف الموسيقى.', 422);
  if (String(f.get('confirm') ?? '') !== '1') throw new AppError('VALIDATION', 'أكّد أنك تملك ترخيص استخدام هذه الموسيقى تجاريًا.', 422);
  const t = await addTrack({ name: file.name, type: file.type, buf: Buffer.from(await file.arrayBuffer()) }, {
    name: String(f.get('name') ?? ''), mood: String(f.get('mood') ?? 'upbeat'), licenseNote: String(f.get('licenseNote') ?? ''),
    startSec: Number(f.get('startSec') ?? 0) || 0, bpm: Number(f.get('bpm') ?? 0) || null, actor: user.email,
  });
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'audio.track.add', targetType: 'audio_track', targetId: t.id, details: { name: t.name, mood: t.mood, license: t.licenseNote, durationSec: t.durationSec } });
  return NextResponse.json(t, { status: 201 });
});
