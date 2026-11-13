import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { audit } from '@/lib/audit';
import { getSettings, updateSettings, secretStatus, setSecret, getSecret } from '@/lib/settings';
import { FREELLM_BASE_URL } from '@/lib/ai';

/** FreeLLMAPI (optional, ideas only): status, enable/disable, model, unified key (write-only), connection test. */
export const GET = api('settings:ai', async () => {
  const s = await getSettings();
  return NextResponse.json({ ...s.ai.freeLlm, key: await secretStatus('FREELLM_API_KEY') });
});

const Body = z.object({ enabled: z.boolean(), model: z.string().trim().min(1).max(120).default('auto'), apiKey: z.string().max(300).optional() });
export const PUT = api('settings:ai', async (req, { user }) => {
  const b = Body.parse(await req.json());
  if (b.apiKey === '__delete__') await setSecret('FREELLM_API_KEY', null, user.email);
  else if (b.apiKey?.trim()) await setSecret('FREELLM_API_KEY', b.apiKey.trim(), user.email);
  const s = await updateSettings((x) => ({ ...x, ai: { ...x.ai, freeLlm: { enabled: b.enabled, model: b.model } } }), user.email);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'settings.freellm.update', details: { enabled: b.enabled, model: b.model, keyChanged: !!b.apiKey } });
  return NextResponse.json({ ...s.ai.freeLlm, key: await secretStatus('FREELLM_API_KEY') });
});

/** Connection test: lists the router's models with the saved key (no tokens spent). */
export const POST = api('settings:ai', async () => {
  const key = await getSecret('FREELLM_API_KEY');
  if (!key) return NextResponse.json({ ok: false, message: 'أدخل المفتاح الموحد من لوحة FreeLLMAPI أولًا.' });
  try {
    const list = await new OpenAI({ apiKey: key, baseURL: FREELLM_BASE_URL, timeout: 15_000, maxRetries: 0 }).models.list();
    const n = list.data.length;
    return NextResponse.json({ ok: n > 0, message: n ? `متصل ✓ — ${n} نموذج متاح` : 'متصل، لكن لا توجد نماذج: أضف مفاتيح المزوّدين في لوحة FreeLLMAPI.' });
  } catch (e) {
    return NextResponse.json({ ok: false, message: `تعذّر الاتصال بـ FreeLLMAPI (${(e as Error).message.slice(0, 120)}). شغّله على السيرفر: bash scripts/freellm.sh` });
  }
});
