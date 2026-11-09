import OpenAI from 'openai';
import { AiProviderError, CreativeBriefJsonSchema, CreativeBriefSchema, type AiProvider, type BriefRequest } from './types';
import { briefSystemPrompt, briefUserPrompt } from './prompts';

function mapError(e: unknown): AiProviderError {
  if (e instanceof OpenAI.APIError) {
    const code = (e as { code?: string }).code;
    if (e.status === 401) return new AiProviderError('AUTH', 'مفتاح OpenAI غير صالح أو ملغى (401).', false);
    if (e.status === 429 && (code === 'insufficient_quota' || /quota|billing/i.test(e.message))) return new AiProviderError('BILLING', 'رصيد OpenAI غير كافٍ أو الفوترة غير مفعّلة (insufficient_quota).', false);
    if (e.status === 429) return new AiProviderError('RATE_LIMIT', 'تم تجاوز حد معدل طلبات OpenAI مؤقتًا.', true);
    if (e.status === 400 && /safety|policy|moderation/i.test(e.message)) return new AiProviderError('CONTENT_POLICY', `رُفض الطلب بسبب سياسة المحتوى: ${e.message}`, false);
    if (e.status === 403) return new AiProviderError('AUTH', `لا يملك المفتاح صلاحية هذا النموذج: ${e.message}`, false);
    if ((e.status ?? 0) >= 500) return new AiProviderError('NETWORK', `خطأ من خادم OpenAI (${e.status}).`, true);
    return new AiProviderError('UNKNOWN', `OpenAI ${e.status}: ${e.message}`, false);
  }
  if (e instanceof OpenAI.APIConnectionError) return new AiProviderError('NETWORK', 'تعذر الاتصال بـ OpenAI.', true);
  return new AiProviderError('UNKNOWN', e instanceof Error ? e.message : String(e), false);
}

export class OpenAiProvider implements AiProvider {
  readonly name = 'openai';
  readonly isDryRun = false;
  private client: OpenAI;
  constructor(apiKey: string, client?: OpenAI) {
    this.client = client ?? new OpenAI({ apiKey, timeout: 180_000, maxRetries: 0 });
  }

  async generateBrief(req: BriefRequest, model: string) {
    let res;
    try {
      res = await this.client.chat.completions.create({
        model,
        temperature: 0.9,
        messages: [{ role: 'system', content: briefSystemPrompt() }, { role: 'user', content: briefUserPrompt(req) }],
        response_format: { type: 'json_schema', json_schema: { name: 'creative_brief', strict: true, schema: CreativeBriefJsonSchema as unknown as Record<string, unknown> } },
      });
    } catch (e) { throw mapError(e); }
    const content = res.choices[0]?.message?.content;
    if (!content) throw new AiProviderError('BAD_OUTPUT', 'استجابة فارغة من نموذج النص.', true);
    let parsed: unknown;
    try { parsed = JSON.parse(content); } catch { throw new AiProviderError('BAD_OUTPUT', 'استجابة JSON غير صالحة.', true); }
    const brief = CreativeBriefSchema.safeParse(parsed);
    if (!brief.success) throw new AiProviderError('BAD_OUTPUT', `الموجز لا يطابق المخطط: ${brief.error.issues[0]?.message}`, true);
    return { brief: brief.data, model: res.model ?? model, usage: { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 } };
  }

  async generateScene(prompt: string, opts: { model: string; quality: 'low' | 'medium' | 'high'; size: '1024x1536' | '1024x1024' | '1536x1024' }) {
    let res;
    try {
      res = await this.client.images.generate({ model: opts.model, prompt, size: opts.size, quality: opts.quality, n: 1 });
    } catch (e) { throw mapError(e); }
    const item = res.data?.[0];
    if (item?.b64_json) return { png: Buffer.from(item.b64_json, 'base64'), model: opts.model, revisedPrompt: item.revised_prompt ?? undefined };
    if (item?.url) {
      const r = await fetch(item.url);
      if (!r.ok) throw new AiProviderError('NETWORK', 'تعذر تنزيل الصورة المولدة.', true);
      return { png: Buffer.from(await r.arrayBuffer()), model: opts.model };
    }
    throw new AiProviderError('BAD_OUTPUT', 'لم تُرجع واجهة الصور أي صورة.', true);
  }

  /** Lightweight credential check used by the AI settings page. */
  async verify(): Promise<{ ok: boolean; message: string }> {
    try { await this.client.models.list(); return { ok: true, message: 'تم التحقق من مفتاح OpenAI.' }; }
    catch (e) { const m = mapError(e); return { ok: false, message: m.message }; }
  }
}
