import OpenAI, { toFile } from 'openai';
import { normalizeBrief, briefIssueAr } from './brief-normalize';
import type { CommentAnalysis, CommentAnalysisRequest } from './types';
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
export const DROPPABLE_PARAMS = ['temperature', 'top_p', 'presence_penalty', 'frequency_penalty', 'seed', 'logprobs', 'top_logprobs', 'quality', 'n', 'max_tokens', 'input_fidelity'] as const;

/** Returns the optional parameter a 400 error complains about, if any. */
export function rejectedParam(e: unknown, sent: Record<string, unknown>): string | null {
  if (!(e instanceof OpenAI.APIError) || e.status !== 400) return null;
  const param = (e as { param?: string | null }).param ?? undefined;
  const msg = e.message ?? '';
  const candidates: string[] = [...DROPPABLE_PARAMS, 'response_format'];
  if (param && candidates.includes(param) && param in sent) return param;
  if (!/unsupported|not supported|does not support|unrecognized|unknown parameter|invalid.*parameter/i.test(msg)) return null;
  // Prefer the exact quoted parameter; a substring match would confuse `n` with any word.
  const quoted = [...msg.matchAll(/['"\x60]([a-z_][a-z_0-9]*)['"\x60]/gi)].map((m) => m[1]);
  const exact = quoted.find((k) => candidates.includes(k) && k in sent);
  if (exact) return exact;
  return candidates.find((k) => k in sent && new RegExp(`\\b${k}\\b`).test(msg)) ?? null;
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

/** the image model that always works on a verified OpenAI account — used when the chosen one is not available */
export const FALLBACK_IMAGE_MODEL = 'gpt-image-1';
/** «this model does not exist / is not enabled for this key» (404 model_not_found, 400 invalid model, 403 no access) */
export function isModelUnavailable(e: unknown) {
  if (!(e instanceof OpenAI.APIError)) return false;
  const code = (e as { code?: string }).code ?? '';
  return code === 'model_not_found' || ((e.status === 404 || e.status === 400 || e.status === 403) && /model/i.test(e.message) && /(not (found|exist|available|supported)|does not exist|invalid|access|verif)/i.test(e.message));
}

const warnedModels = new Set<string>();
const warnDrop = (where: string) => (param: string) => console.warn(`[openai] ${where}: model rejected optional parameter "${param}" — retrying without it`);

export class OpenAiProvider implements AiProvider {
  readonly name = 'openai';
  /** set when the chosen image model was unavailable and the fallback was used (read by the caller to tell the owner) */
  imageModelFallback: { wanted: string; reason: string } | null = null;
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

  async inspectPoster(png: Buffer, model: string, zones: { bottomPct: number; productHint: string }) {
    let res;
    try {
      res = await callWithParamFallback({
        model,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user' as const, content: [
          { type: 'text' as const, text: [
            'You are a strict print-advertising QA inspector. Inspect this poster image and answer in JSON only:',
            '{"text": "<ALL visible text exactly as written, any language, one item per line; do not translate or correct; append [?] to malformed or illegible words>",',
            ` "productVisible": <true if the hero product (${zones.productHint}) is clearly shown, sharp and complete — not cut off by the frame edges, not distorted>,`,
            ` "bottomClear": <true if the bottom ${zones.bottomPct}% of the image contains ONLY background/surface/decoration — no product, no text, no icons, no badges>,`,
            ' "issues": ["<short concrete problems: e.g. product cut off at the left edge, icons in the bottom zone, warped letters, extra stray text>"]}',
          ].join('\n') },
          { type: 'image_url' as const, image_url: { url: `data:image/jpeg;base64,${png.toString('base64')}` } },
        ] }],
      }, (p) => this.client.chat.completions.create(p as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming), warnDrop('inspect-poster'));
    } catch (e) { throw mapError(e); }
    let j: { text?: unknown; productVisible?: unknown; bottomClear?: unknown; issues?: unknown };
    try { j = JSON.parse(res.choices[0]?.message?.content ?? '{}'); } catch { throw new AiProviderError('BAD_OUTPUT', 'استجابة JSON غير صالحة.', true); }
    const issues = Array.isArray(j.issues) ? j.issues.map(String).filter((x) => x.trim()).slice(0, 6) : [];
    return { text: String(j.text ?? ''), layout: { productVisible: j.productVisible !== false, bottomClear: j.bottomClear !== false, issues }, model: res.model ?? model, usage: { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 } };
  }

  async analyzeComments(req: CommentAnalysisRequest, model: string) {
    const schema = { type: 'object', additionalProperties: false, required: ['items'], properties: { items: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['id', 'category', 'sentiment', 'urgent', 'language', 'summary', 'reply'], properties: {
        id: { type: 'string' }, category: { type: 'string', enum: ['order', 'price', 'info', 'praise', 'complaint', 'spam', 'other'] },
        sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] }, urgent: { type: 'boolean' },
        language: { type: 'string', enum: ['ar', 'en', 'ml', 'other'] }, summary: { type: 'string' }, reply: { type: 'string' },
      } } } } };
    const system = [
      `You are the community manager of "${req.business}", a print shop in Bahrain. Triage each Instagram comment and draft ONE reply.`,
      'category: order (wants to buy/order/book), price (asks price/cost), info (other question), praise, complaint, spam (links, self-promotion, bots, scams), other.',
      'urgent = true for order, price and complaint (a customer is waiting). summary = 3-8 Arabic words describing what the person wants.',
      'reply: in the commenter\'s language (Arabic → warm, natural Bahraini/Gulf dialect; English → friendly English). Start with @username when given. Max 220 characters, at most 2 emojis.',
      `For order/price/info: invite them to WhatsApp or a call using EXACTLY these numbers: ${req.phones.map((p) => `${p.label} ${p.phone}`).join(' · ')}.`,
      'For complaints: apologise sincerely, no excuses, move to DM/phone. For praise: thank warmly. For spam: reply "".',
      'NEVER state prices, discounts, free items, delivery times, guarantees, rankings ("الأفضل") or any number other than the two phones. Never invent facts about the order. No links.',
    ].join('\n');
    let res;
    try {
      res = await callWithParamFallback({
        model,
        messages: [{ role: 'system' as const, content: system }, { role: 'user' as const, content: JSON.stringify({ comments: req.comments }) }],
        response_format: { type: 'json_schema', json_schema: { name: 'comment_triage', strict: true, schema } },
      }, (p) => this.client.chat.completions.create(p as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming), warnDrop('comments'));
    } catch (e) { throw mapError(e); }
    let items: CommentAnalysis[] = [];
    try { items = (JSON.parse(res.choices[0]?.message?.content ?? '{}').items ?? []) as CommentAnalysis[]; } catch { throw new AiProviderError('BAD_OUTPUT', 'استجابة JSON غير صالحة.', true); }
    return { items, model: res.model ?? model, usage: { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 } };
  }

  async generateJson(system: string, user: string, model: string) {
    let res;
    try {
      res = await callWithParamFallback({
        model,
        messages: [{ role: 'system' as const, content: system }, { role: 'user' as const, content: user }],
        response_format: { type: 'json_object' },
      }, (p) => this.client.chat.completions.create(p as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming), warnDrop('json'));
    } catch (e) { throw mapError(e); }
    let json: unknown;
    try { json = JSON.parse(res.choices[0]?.message?.content ?? '{}'); } catch { throw new AiProviderError('BAD_OUTPUT', 'استجابة JSON غير صالحة.', true); }
    return { json, model: res.model ?? model, usage: { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 } };
  }

  async describeStyle(png: Buffer, model: string) {
    let res;
    try {
      res = await callWithParamFallback({
        model,
        messages: [{ role: 'user' as const, content: [
          { type: 'text' as const, text: 'You are an art director. Describe ONLY the visual style of this advertising poster so a designer can reach the same quality level for a DIFFERENT product: colour palette, lighting and mood, background treatment, typography style (weight, effects such as gold 3D, outlines, shadows), badge/ribbon/frame shapes, decorative elements, layout rhythm and hierarchy, finish and level of detail. Do NOT mention or describe the product, any objects, people, characters, illustrations, written words, slogans, logos, brand names or phone numbers. 80–120 words, English, one paragraph.' },
          { type: 'image_url' as const, image_url: { url: `data:image/png;base64,${png.toString('base64')}` } },
        ] }],
      }, (p) => this.client.chat.completions.create(p as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming), warnDrop('describe-style'));
    } catch (e) { throw mapError(e); }
    return { text: (res.choices[0]?.message?.content ?? '').trim().slice(0, 1200), model: res.model ?? model, usage: { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 } };
  }

  async scoreAd(jpeg: Buffer, model: string, ctx: { product: string; idea: string; platform: string }) {
    const { scoreAdPrompt } = await import('../creative/ad-score');
    let res;
    try {
      res = await callWithParamFallback({
        model,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user' as const, content: [
          { type: 'text' as const, text: scoreAdPrompt(ctx) },
          { type: 'image_url' as const, image_url: { url: `data:image/jpeg;base64,${jpeg.toString('base64')}` } },
        ] }],
      }, (p) => this.client.chat.completions.create(p as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming), warnDrop('score-ad'));
    } catch (e) { throw mapError(e); }
    let j: Record<string, unknown> = {};
    try { j = JSON.parse(res.choices[0]?.message?.content ?? '{}'); } catch { throw new AiProviderError('BAD_OUTPUT', 'استجابة JSON غير صالحة.', true); }
    const judged = Object.fromEntries(['attention', 'creativity', 'image', 'clarity', 'share'].map((k) => [k, Number(j[k]) || 0]));
    return { judged, weakness: String(j.weakness ?? ''), fix: String(j.fix ?? ''), model: res.model ?? model, usage: { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 } };
  }

  async judgeImages(images: Buffer[], brief: string, model: string) {
    let res;
    try {
      res = await callWithParamFallback({
        model,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user' as const, content: [
          { type: 'text' as const, text: `You are a senior art director judging ${images.length} candidate advertising photos (in order, index 0..${images.length - 1}) for this brief:\n${brief}\n\nScore each 0-100 on: product accuracy and realistic shape (heaviest weight), professional commercial aesthetics and lighting, striking scroll-stopping composition, fit to the brief, photographic realism (consistent light, real contact shadows, true material texture), NO stray text/letters/logos (any visible text = max 40), and NO AI artefacts — distorted hands or faces, extra fingers, melted/warped/duplicated objects, floating products, plastic skin or HDR halos (any such defect = max 50). Return JSON {"scores":[numbers in order],"best":index,"reason":"one short sentence"}.` },
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

  async generateScene(prompt: string, opts: { model: string; quality: 'low' | 'medium' | 'high'; size: '1024x1536' | '1024x1024' | '1536x1024'; references?: Buffer[]; background?: 'transparent' | 'opaque' }) {
    const bg = opts.background === 'transparent' ? { background: 'transparent', output_format: 'png' } : {};
    const run = async (model: string) => {
      // reference images (real product photo / reference design) → the edits endpoint with several input images
      if (opts.references?.length) {
        const image = await Promise.all(opts.references.slice(0, 4).map((b, i) => toFile(b, `reference-${i + 1}.png`, { type: 'image/png' })));
        return callWithParamFallback(
          {
            model, prompt, image, size: opts.size, quality: opts.quality, n: 1,
            // GPT Image 2 uses high input fidelity automatically and rejects this parameter.
            // Request it explicitly only for the older models known to support the high setting.
            ...(/^gpt-image-1(?:\.5)?(?:-\d{4}-\d{2}-\d{2})?$/.test(model) ? { input_fidelity: 'high' } : {}),
          },
          (p) => this.client.images.edit(p as unknown as OpenAI.Images.ImageEditParamsNonStreaming), warnDrop('image-edit'));
      }
      return callWithParamFallback(
        { model, prompt, size: opts.size, quality: opts.quality, n: 1, ...bg },
        (p) => this.client.images.generate(p as unknown as OpenAI.Images.ImageGenerateParamsNonStreaming), warnDrop('image'));
    };
    let res; let used = opts.model;
    try { res = await run(used); }
    catch (e) {
      // a newer model (e.g. gpt-image-2) not enabled for this key/organisation → keep designing with the proven model
      if (!isModelUnavailable(e) || used === FALLBACK_IMAGE_MODEL) throw mapError(e);
      console.warn(`[openai] image model "${used}" is not available for this key — falling back to ${FALLBACK_IMAGE_MODEL}`);
      this.imageModelFallback = { wanted: used, reason: (e as Error).message.slice(0, 200) };
      if (!warnedModels.has(used)) {
        warnedModels.add(used);
        const wanted = used;
        void import('../audit').then(({ notify }) => notify('WARNING', 'IMAGE_MODEL_FALLBACK', `نموذج الصور «${wanted}» غير متاح لمفتاحك`,
          `استُخدم ${FALLBACK_IMAGE_MODEL} تلقائيًا حتى لا تتوقف التصاميم. فعّل النموذج في حساب OpenAI (قد يحتاج توثيق المؤسسة) أو غيّر «نموذج الصور» في إعدادات الذكاء الاصطناعي.`)).catch(() => undefined);
      }
      used = FALLBACK_IMAGE_MODEL;
      try { res = await run(used); } catch (e2) { throw mapError(e2); }
    }
    const item = res.data?.[0];
    if (item?.b64_json) return { png: Buffer.from(item.b64_json, 'base64'), model: used, revisedPrompt: item.revised_prompt ?? undefined };
    if (item?.url) {
      const r = await fetch(item.url, { signal: AbortSignal.timeout(60_000) }).catch(() => null);
      if (!r) throw new AiProviderError('NETWORK', 'تعذر تنزيل الصورة المولدة (انتهت المهلة).', true);
      if (!r.ok) throw new AiProviderError('NETWORK', 'تعذر تنزيل الصورة المولدة.', true);
      return { png: Buffer.from(await r.arrayBuffer()), model: used };
    }
    throw new AiProviderError('BAD_OUTPUT', 'لم تُرجع واجهة الصور أي صورة.', true);
  }

  /** Lightweight credential check used by the AI settings page. */
  async verify(): Promise<{ ok: boolean; message: string }> {
    try { await this.client.models.list(); return { ok: true, message: 'تم التحقق من مفتاح OpenAI.' }; }
    catch (e) { const m = mapError(e); return { ok: false, message: m.message }; }
  }
}
