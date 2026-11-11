import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { getSettings, updateSettings } from '@/lib/settings';
import { audit } from '@/lib/audit';
import { PERSONAS, VOICE_LANGS } from '@/lib/audio/voices';

const Body = z.object({
  persona: z.string().refine((v) => v === 'auto' || PERSONAS.some((p) => p.id === v), 'شخصية غير معروفة'),
  voiceLang: z.string().refine((v) => v === 'auto' || VOICE_LANGS.some((l) => l.id === v), 'لغة غير معروفة'),
  sfx: z.boolean(),
  musicVolume: z.number().min(0.1).max(1),
  defaultReelAudio: z.enum(['none', 'ambient', 'upbeat', 'library', 'voiceover', 'instagram']),
});
export const GET = api('settings:ai', async () => NextResponse.json((await getSettings()).ai.audio));
export const PUT = api('settings:ai', async (req, { user }) => {
  const b = Body.parse(await req.json());
  const s = await updateSettings((x) => ({ ...x, ai: { ...x.ai, audio: { ...x.ai.audio, ...b } } }), user.email);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'settings.audio.update', details: b });
  return NextResponse.json(s.ai.audio);
});
