import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { getSettings, secretStatus, setSecret, updateSettings } from '@/lib/settings';
import { audit } from '@/lib/audit';

const Body = z.object({
  apiKey: z.string().max(300).optional(), // write-only; "__delete__" removes
  engine: z.enum(['ffmpeg', 'veo']),
  veoModel: z.string().regex(/^veo-[a-z0-9.\-]+$/).max(80),
  veoDurationSec: z.union([z.literal(4), z.literal(6), z.literal(8)]),
  veoResolution: z.enum(['720p', '1080p']),
  veoPricePerSec: z.number().min(0).max(10),
  maxVeoPerDay: z.number().int().min(0).max(200),
  nativeAudio: z.boolean(),
  fallbackToFfmpeg: z.boolean(),
});
const status = async () => { const k = await secretStatus('GEMINI_API_KEY'); return { configured: k.configured, last4: k.last4 }; };

export const GET = api('settings:ai', async () => NextResponse.json({ video: (await getSettings()).ai.video, key: await status() }));
export const PUT = api('settings:ai', async (req, { user }) => {
  const { apiKey, ...video } = Body.parse(await req.json());
  if (apiKey === '__delete__') await setSecret('GEMINI_API_KEY', null, user.email);
  else if (apiKey) await setSecret('GEMINI_API_KEY', apiKey.trim(), user.email);
  const s = await updateSettings((x) => ({ ...x, ai: { ...x.ai, video: { ...x.ai.video, ...video } } }), user.email);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'settings.gemini.update', details: { keyChanged: !!apiKey, engine: video.engine, model: video.veoModel, maxPerDay: video.maxVeoPerDay } });
  return NextResponse.json({ video: s.ai.video, key: await status() });
});
