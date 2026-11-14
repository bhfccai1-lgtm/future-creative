import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { audit } from '@/lib/audit';
import { getSettings, updateSettings, secretStatus, setSecret, getSecret } from '@/lib/settings';
import { FREELLM_BASE_URL } from '@/lib/ai';
import { probeFreeLlmGeneration } from '@/lib/ai/freellm-check';

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

/** Live verification: a models list alone does not prove provider keys can generate.
 * This sends one short completion, which may consume free-tier quota.
 */
export const POST = api('settings:ai', async () => {
  const key = await getSecret('FREELLM_API_KEY');
  if (!key) return NextResponse.json({ ok: false, message: 'احفظ المفتاح الموحد أولًا ثم اختبر التوليد.' });
  const s = await getSettings();
  const model = s.ai.freeLlm.model?.trim() || 'auto';
  try {
    const client = new OpenAI({ apiKey: key, baseURL: FREELLM_BASE_URL, timeout: 30_000, maxRetries: 0 });
    const { servedModel } = await probeFreeLlmGeneration(() => client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
      stream: false,
    }));
    return NextResponse.json({ ok: true, message: `نجح اختبار التوليد الفعلي ✓ — النموذج: ${servedModel}` });
  } catch (e) {
    // Do not return raw SDK/network errors: they can contain internal URLs and provider details.
    let message = 'تعذّر توليد رد عبر FreeLLMAPI. تأكد أن الخدمة تعمل وأن مفاتيح المزوّدين صالحة.';
    if (e instanceof OpenAI.APIError) {
      if (e.status === 401 || e.status === 403) message = 'المفتاح الموحد غير صالح أو ليس له صلاحية (401/403).';
      else if (e.status === 429) message = 'بلغت حدود استخدام المزوّد. جرّب لاحقًا أو أضف مزوّدًا آخر.';
      else if (e.status === 404 || e.status === 400) message = 'النموذج غير متاح أو لا يقبل الطلب. جرّب auto وتحقق من إعدادات المزوّدين.';
    } else if (e instanceof Error && e.message === 'FREELLM_EMPTY_COMPLETION') {
      message = 'وصل الطلب، لكن النموذج لم يُرجع نصًا. لم ينجح اختبار التوليد.';
    }
    return NextResponse.json({ ok: false, message });
  }
});
