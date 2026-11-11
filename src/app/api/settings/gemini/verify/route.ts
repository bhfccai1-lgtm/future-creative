import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { getSecret, getSettings } from '@/lib/settings';
import { VeoProvider } from '@/lib/ai/veo';
import { audit } from '@/lib/audit';

/** Read-only check: key valid + configured Veo model available to this Google account (no video is generated, no cost). */
export const POST = api('settings:ai', async (_req, { user }) => {
  const key = await getSecret('GEMINI_API_KEY');
  if (!key) return NextResponse.json({ ok: false, message: 'أدخل مفتاح Gemini API واحفظه أولًا.', models: [] });
  const r = await new VeoProvider({ apiKey: key, model: (await getSettings()).ai.video.veoModel }).verify();
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'settings.gemini.verify', details: { ok: r.ok, models: r.models } });
  return NextResponse.json(r);
});
