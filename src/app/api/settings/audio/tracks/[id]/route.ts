import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';

type P = { params: Promise<{ id: string }> };
const Patch = z.object({ active: z.boolean().optional(), mood: z.enum(['upbeat', 'calm', 'luxury', 'festive', 'corporate']).optional(), startSec: z.number().min(0).max(600).optional() });
export const PATCH = api<P>('settings:ai', async (req, { user, params }) => {
  const { id } = await params;
  const t = await prisma.audioTrack.update({ where: { id }, data: Patch.parse(await req.json()) });
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'audio.track.update', targetType: 'audio_track', targetId: id, details: { active: t.active, mood: t.mood } });
  return NextResponse.json(t);
});
/** Deactivated rather than deleted: published reels may still reference the track (licence record). */
export const DELETE = api<P>('settings:ai', async (_req, { user, params }) => {
  const { id } = await params;
  await prisma.audioTrack.update({ where: { id }, data: { active: false } });
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'audio.track.deactivate', targetType: 'audio_track', targetId: id });
  return NextResponse.json({ ok: true });
});
