import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { getSettings, secretStatus, setSecret, updateSettings } from '@/lib/settings';
import { audit } from '@/lib/audit';

/** «الإلهام من Freepik»: the key is write-only (stored encrypted, never returned); the research is off until switched on */
const Body = z.object({
  apiKey: z.string().max(300).optional(), // write-only; "__delete__" removes
  enabled: z.boolean(),
  count: z.number().int().min(5).max(10),
  freeOnly: z.boolean(),
});
const status = async () => { const k = await secretStatus('FREEPIK_API_KEY'); return { configured: k.configured, last4: k.last4 }; };

export const GET = api('settings:ai', async () => NextResponse.json({ inspiration: (await getSettings()).ai.inspiration, key: await status() }));
export const PUT = api('settings:ai', async (req, { user }) => {
  const { apiKey, ...insp } = Body.parse(await req.json());
  if (apiKey === '__delete__') await setSecret('FREEPIK_API_KEY', null, user.email);
  else if (apiKey?.trim()) await setSecret('FREEPIK_API_KEY', apiKey.trim(), user.email);
  const key = await status();
  // research cannot be on without a key — it would silently do nothing
  const s = await updateSettings((x) => ({ ...x, ai: { ...x.ai, inspiration: { ...insp, enabled: insp.enabled && key.configured } } }), user.email);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'settings.inspiration.update', details: { keyChanged: !!apiKey, enabled: s.ai.inspiration.enabled, count: insp.count, freeOnly: insp.freeOnly } });
  return NextResponse.json({ inspiration: s.ai.inspiration, key });
});
