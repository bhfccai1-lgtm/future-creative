import { describe, expect, it } from 'vitest';
import OpenAI from 'openai';
import { OpenAiProvider, callWithParamFallback, rejectedParam } from '@/lib/ai/openai-provider';
import { AiProviderError, type BriefRequest } from '@/lib/ai/types';

/** Real OpenAI SDK error objects, exactly as the API returns them for unsupported parameters. */
const unsupported = (param: string, message: string) =>
  OpenAI.APIError.generate(400, { error: { message, type: 'invalid_request_error', param, code: 'unsupported_value' } }, message, new Headers());

const TEMPERATURE_400 = "Unsupported value: 'temperature' does not support 0.9 with this model. Only the default (1) value is supported.";

const req: BriefRequest = {
  language: 'ar', accountName: 'bhfcc.mugs', creativeStyle: 'premium', defaultCta: 'اطلب الآن', avoidIdeas: [], avoidHeadlines: [], attempt: 0,
  product: { slug: 'ceramic-mugs', name: 'Ceramic mug printing', titleAr: 'طباعة على أكواب السيراميك', titleEn: 'Ceramic Mug Printing', targetAudience: ['families'], occasions: ['gifts'], visualGuidelines: 'Premium white ceramic mug, warm light.', recommendedMessages: { ar: ['كوب مطبوع بتصميمك الخاص'] } },
};

const validBrief = {
  idea: 'Personalised family mug on a breakfast table', ideaKey: 'mug-family-breakfast', audience: 'families', occasion: 'everyday',
  sceneDescription: 'A premium white ceramic mug with a printed family photo on a sunny breakfast table, no text, no logos.',
  headline: 'كوب يحمل ذكرياتكم', supportingCopy: 'اطبع صورتك المفضلة على كوب', cta: 'اطلب الآن',
  caption: 'كوب يحمل أجمل ذكرياتكم ☕', hashtags: ['#البحرين'], styleNotes: 'warm',
};

/** Fake client that behaves like a model which only accepts the default temperature. */
function strictModelClient() {
  const calls: Record<string, unknown>[] = [];
  const reject = (p: Record<string, unknown>) => {
    calls.push(p);
    if ('temperature' in p && p.temperature !== 1) throw unsupported('temperature', TEMPERATURE_400);
    if ('top_p' in p) throw unsupported('top_p', "Unsupported parameter: 'top_p' is not supported with this model.");
  };
  const client = {
    chat: { completions: { create: async (p: Record<string, unknown>) => {
      reject(p);
      const ideas = String((p.messages as { content: string }[])[1].content).includes('Return exactly');
      return { model: String(p.model), usage: { prompt_tokens: 100, completion_tokens: 50 }, choices: [{ message: { content: JSON.stringify(ideas ? { ideas: [{ title: 'فكرة', idea: 'كوب عائلي' }] } : validBrief) } }] };
    } } },
    images: { generate: async (p: Record<string, unknown>) => { calls.push(p); return { data: [{ b64_json: Buffer.from('png').toString('base64') }] }; } },
    models: { list: async () => ({}) },
  };
  return { client: client as unknown as OpenAI, calls };
}

describe('OpenAI provider — regression: 400 "Unsupported value: temperature"', () => {
  it('generateBrief does not send temperature/top_p and succeeds on a model that only allows the default', async () => {
    const { client, calls } = strictModelClient();
    const r = await new OpenAiProvider('sk-test', client).generateBrief(req, 'gpt-6-luna');
    expect(r.brief.headline).toBe('كوب يحمل ذكرياتكم');
    expect(calls).toHaveLength(1); // first request already valid — no retry needed
    for (const k of ['temperature', 'top_p', 'presence_penalty', 'frequency_penalty']) expect(calls[0]).not.toHaveProperty(k);
    expect(calls[0]).toMatchObject({ model: 'gpt-6-luna', response_format: { type: 'json_schema' } });
  });

  it('suggestIdeas does not send temperature either', async () => {
    const { client, calls } = strictModelClient();
    const r = await new OpenAiProvider('sk-test', client).suggestIdeas(req, 'gpt-6-luna', 3);
    expect(r.ideas[0].title).toBe('فكرة');
    expect(calls[0]).not.toHaveProperty('temperature');
  });

  it('if a model rejects an optional parameter anyway, it is removed and the request retried once', async () => {
    const seen: Record<string, unknown>[] = [];
    const out = await callWithParamFallback({ model: 'm', messages: [], temperature: 0.9 }, async (p) => {
      seen.push(p);
      if ('temperature' in p) throw unsupported('temperature', TEMPERATURE_400);
      return 'ok';
    });
    expect(out).toBe('ok');
    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual({ model: 'm', messages: [] });
  });

  it('detects the rejected parameter from the message when `param` is missing', () => {
    const e = OpenAI.APIError.generate(400, { error: { message: "Unsupported parameter: 'top_p' is not supported with this model." } }, 'x', new Headers());
    expect(rejectedParam(e, { model: 'm', top_p: 0.5 })).toBe('top_p');
  });

  it('downgrades json_schema → json_object when structured outputs are unsupported, keeping validation', async () => {
    const seen: Record<string, unknown>[] = [];
    await callWithParamFallback({ model: 'm', messages: [{ role: 'user', content: 'x' }], response_format: { type: 'json_schema', json_schema: {} } }, async (p) => {
      seen.push(p);
      if ((p.response_format as { type: string }).type === 'json_schema') throw unsupported('response_format', "Invalid parameter: 'response_format' of type 'json_schema' is not supported with this model.");
      return 'ok';
    });
    expect((seen[1].response_format as { type: string }).type).toBe('json_object');
  });

  it('never retries other 400 errors or drops required fields (model/messages/prompt)', async () => {
    let n = 0;
    const policy = OpenAI.APIError.generate(400, { error: { message: 'Your request was rejected as a result of our safety system.', param: null } }, 'x', new Headers());
    await expect(callWithParamFallback({ model: 'm', prompt: 'p' }, async () => { n++; throw policy; })).rejects.toBe(policy);
    expect(n).toBe(1);
    const badModel = unsupported('model', "The model 'gpt-x' does not exist");
    expect(rejectedParam(badModel, { model: 'gpt-x' })).toBeNull();
  });

  it('maps a non-recoverable OpenAI 400 to a clear provider error (ad FAILED, no blind retries)', async () => {
    const client = { chat: { completions: { create: async () => { throw OpenAI.APIError.generate(400, { error: { message: "The model 'nope' does not exist", param: 'model' } }, 'x', new Headers()); } } } } as unknown as OpenAI;
    await expect(new OpenAiProvider('k', client).generateBrief(req, 'nope')).rejects.toBeInstanceOf(AiProviderError);
  });

  it('image generation keeps size/quality but survives a model that rejects quality', async () => {
    const seen: Record<string, unknown>[] = [];
    const client = { images: { generate: async (p: Record<string, unknown>) => {
      seen.push(p);
      if ('quality' in p) throw unsupported('quality', "Unsupported value: 'quality'.");
      return { data: [{ b64_json: Buffer.from('img').toString('base64') }] };
    } } } as unknown as OpenAI;
    const r = await new OpenAiProvider('k', client).generateScene('scene', { model: 'gpt-image-2', quality: 'high', size: '1024x1536' });
    expect(r.png.toString()).toBe('img');
    expect(seen[0]).toMatchObject({ model: 'gpt-image-2', size: '1024x1536', quality: 'high', n: 1 });
    expect(seen[1]).not.toHaveProperty('quality');
    expect(seen[1]).toMatchObject({ size: '1024x1536', prompt: 'scene' });
  });
});
