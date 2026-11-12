import OpenAI from 'openai';
import { normalizeBrief, briefIssueAr } from './brief-normalize';
import { AiProviderError, CreativeBriefJsonSchema, CreativeBriefSchema, IdeaSuggestionsJsonSchema, type AiProvider, type BriefRequest, type IdeaSuggestion, type VoiceoverRequest } from './types';
import { voiceoverSystemPrompt } from './prompts';
import { briefSystemPrompt, briefUserPrompt, ideasSystemPrompt } from './prompts';

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

/**
 * Optional request parameters that some models reject (e.g. reasoning / newer models accept only
 * the default temperature and return 400 "Unsupported value: 'temperature'").
 * We never send sampling parameters by default; if a model still rejects one of these optional
 * parameters, it is removed and the request is retried — core fields (model, messages, prompt) are never touched.
 */
export const DROPPABLE_PARAMS = ['temperature', 'top_p', 'presence_penalty', 'frequency_penalty', 'seed', 'logprobs', 'top_logprobs', 'quality', 'n', 'max_tokens'] as const;

/** Returns the optional parameter a 400 error complains about, if any. */
export function rejectedParam(e: unknown, sent: Record<string, unknown>): string | null {
  if (!(e instanceof OpenAI.APIError) || e.status !== 400) return null;
  const param = (e as { param?: string | null }).param ?? undefined;
  const msg = e.message ?? '';
  const candidates: string[] = [...DROPPABLE_PARAMS, 'response_format'];
  if (param && candidates.includes(param) && param in sent) return param;
  if (!/unsupported|not supported|does not support|unrecognized|unknown parameter|invalid.*parameter/i.test(msg)) return null;
  return candidates.find((k) => k in sent && new RegExp(`['"\`]?${k}['"\`]?`).test(msg)) ?? null;
}

/**
 * Calls the API; on a 400 about an optional parameter, removes it (or downgrades json_schema → json_object)
 * and retries, at most 3 times. Anything else is re-thrown unchanged.
 */
export async function callWithParamFallback<P extends Record<string, unknown>, R>(params: P, call: (p: P) => Promise<R>, onDrop?: (param: string) => void): Promise<R> {
  let current: Record<string, unknown> = { ...params };
  for (let attempt = 0; ; attempt++) {
    try { return await call(current as P); }
    catch (e) {
      const bad = attempt < 3 ? rejectedParam(e, current) : null;
      if (!bad) throw e;
      onDrop?.(bad);
      if (bad === 'response_format') {
        const rf = current.response_format as { type?: string } | undefined;
        if (rf?.type !== 'json_schema') throw e;
        current = { ...current, response_format: { type: 'json_object' } };
        const msgs = current.messages as { role: string; content: string }[] | undefined;
        if (msgs?.length) current.messages = [...msgs, { role: 'system', content: 'Respond with a single JSON object only, using exactly the fields described above.' }];
      } else {
        const { [bad]: _removed, ...rest } = current; void _removed;
        current = rest;
      }
    }
  }
}

const warnDrop = (where: string) => (param: string) => console.warn(`[openai] ${where}: model rejected optional parameter "${param}" — retrying without it`);

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
      // No temperature/top_p: newer models only accept the defaults (400 otherwise).
      res = await callWithParamFallback({
        model,
        messages: [{ role: 'system' as const, content: briefSystemPrompt() }, { role: 'user' as const, content: briefUserPrompt(req) }],
        response_format: { type: 'json_schema', json_schema: { name: 'creative_brief', strict: true, schema: CreativeBriefJsonSchema as unknown as Record<string, unknown> } },
      }, (p) => this.client.chat.completions.create(p as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming), warnDrop('brief'));
    } catch (e) { throw mapError(e); }
    const content = res.choices[0]?.message?.content;
    if (!content) throw new AiProviderError('BAD_OUTPUT', 'استجابة فارغة من نموذج النص.', true);
    let parsed: unknown;
    try { parsed = JSON.parse(content); } catch { throw new AiProviderError('BAD_OUTPUT', 'استجابة JSON غير صالحة.', true); }
    // fit over-long fields instead of failing the whole design (the model ignores length limits sometimes)
    const { brief: fitted, adjusted } = normalizeBrief(parsed, req.defaultCta);
    if (adjusted.length) console.warn(`[openai] brief fields fitted to limits: ${adjusted.join(', ')}`);
    const brief = CreativeBriefSchema.safeParse(fitted);
    if (!brief.success) throw new AiProviderError('BAD_OUTPUT', briefIssueAr(brief.error.issues[0]), true);
    return { brief: brief.data, model: res.model ?? model, usage: { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 } };
  }

  async suggestIdeas(req: BriefRequest, model: string, count: number) {
    let res;
    try {
      res = await callWithParamFallback({
        model,
        messages: [{ role: 'system' as const, content: ideasSystemPrompt() }, { role: 'user' as const, content: briefUserPrompt(req) + `\nReturn exactly ${count} ideas.` }],
        response_format: { type: 'json_schema', json_schema: { name: 'idea_suggestions', strict: true, schema: IdeaSuggestionsJsonSchema as unknown as Record<string, unknown> } },
      }, (p) => this.client.chat.completions.create(p as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming), warnDrop('ideas'));
    } catch (e) { throw mapError(e); }
    let ideas: IdeaSuggestion[] = [];
    try { ideas = (JSON.parse(res.choices[0]?.message?.content ?? '{}').ideas ?? []).slice(0, count); }
    catch { throw new AiProviderError('BAD_OUTPUT', 'استجابة JSON غير صالحة.', true); }
    return { ideas, model: res.model ?? model, usage: { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 } };
  }

  async writeVoiceover(req: VoiceoverRequest, model: string) {
    let res;
    try {
      res = await callWithParamFallback({
        model,
        messages: [{ role: 'system' as const, content: voiceoverSystemPrompt() }, { role: 'user' as const, content: JSON.stringify(req) }],
        response_format: { type: 'json_schema', json_schema: { name: 'voiceover', strict: true, schema: { type: 'object', additionalProperties: false, required: ['script'], properties: { script: { type: 'string', description: 'The spoken script only, in the requested language/dialect.' } } } } },
      }, (p) => this.client.chat.completions.create(p as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming), warnDrop('voiceover'));
    } catch (e) { throw mapError(e); }
    let script = '';
    try { script = String(JSON.parse(res.choices[0]?.message?.content ?? '{}').script ?? '').trim(); }
    catch { throw new AiProviderError('BAD_OUTPUT', 'استجابة JSON غير صالحة.', true); }
    if (!script) throw new AiProviderError('BAD_OUTPUT', 'نص التعليق الصوتي فارغ.', true);
    return { script, model: res.model ?? model, usage: { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 } };
  }

  async readText(png: Buffer, model: string) {
    let res;
    try {
      res = await callWithParamFallback({
        model,
        messages: [{ role: 'user' as const, content: [
          { type: 'text' as const, text: 'Transcribe ALL visible text in this advertisement image exactly as written (any language), one item per line. Do not translate or correct spelling. If a word is malformed or illegible, write it as you see it and append [?].' },
          { type: 'image_url' as const, image_url: { url: `data:image/jpeg;base64,${png.toString('base64')}` } },
        ] }],
      }, (p) => this.client.chat.completions.create(p as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming), warnDrop('read-text'));
    } catch (e) { throw mapError(e); }
    return { text: res.choices[0]?.message?.content ?? '', model: res.model ?? model, usage: { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 } };
  }

  async judgeImages(images: Buffer[], brief: string, model: string) {
    let res;
    try {
      res = await callWithParamFallback({
        model,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user' as const, content: [
          { type: 'text' as const, text: `You are a senior art director judging ${images.length} candidate advertising photos (in order, index 0..${images.length - 1}) for this brief:\n${brief}\n\nScore each 0-100 on: product accuracy and realistic shape (heaviest weight), professional commercial aesthetics and lighting, striking scroll-stopping composition, fit to the brief, and NO stray text/letters/logos (any visible text = max 40). Return JSON {"scores":[numbers in order],"best":index,"reason":"one short sentence"}.` },
          ...images.map((b) => ({ type: 'image_url' as const, image_url: { url: `data:image/jpeg;base64,${b.toString('base64')}`, detail: 'low' as const } })),
        ] }],
      }, (p) => this.client.chat.completions.create(p as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming), warnDrop('judge'));
    } catch (e) { throw mapError(e); }
    const usage = { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 };
    let parsed: { scores?: unknown; best?: unknown; reason?: unknown } = {};
    try { parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}'); } catch { /* fall back below */ }
    const scores = Array.isArray(parsed.scores) ? parsed.scores.map((x) => Number(x) || 0).slice(0, images.length) : [];
    const top = scores.length ? scores.indexOf(Math.max(...scores)) : 0;
    const best = Number.isInteger(parsed.best) && Number(parsed.best) >= 0 && Number(parsed.best) < images.length ? Number(parsed.best) : top;
    return { best, scores, reason: String(parsed.reason ?? '').slice(0, 300), usage, model: res.model ?? model };
  }

  async generateScene(prompt: string, opts: { model: string; quality: 'low' | 'medium' | 'high'; size: '1024x1536' | '1024x1024' | '1536x1024' }) {
    let res;
    try {
      res = await callWithParamFallback(
        { model: opts.model, prompt, size: opts.size, quality: opts.quality, n: 1 },
        (p) => this.client.images.generate(p as unknown as OpenAI.Images.ImageGenerateParamsNonStreaming), warnDrop('image'));
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
