import { getSecret, type Settings } from '../settings';
import { ConfigurationError } from '../errors';
import { DryRunProvider } from './dry-run-provider';
import { OpenAiProvider } from './openai-provider';
import type { AiProvider } from './types';

let override: AiProvider | null = null;
/** Test hook: inject a provider (e.g. one that fails) — never used in production code paths. */
export function setAiProviderOverride(p: AiProvider | null) { override = p; }

export async function getAiProvider(s: Settings): Promise<AiProvider> {
  if (override) return override;
  if (s.ai.dryRun) return new DryRunProvider();
  const key = await getSecret('OPENAI_API_KEY');
  if (!key) throw new ConfigurationError('مفتاح OpenAI غير مضبوط. أضفه من إعدادات الذكاء الاصطناعي أو فعّل وضع التجربة (Dry-run).');
  return new OpenAiProvider(key);
}

/** Internal address of the optional FreeLLMAPI container (docker compose profile «freellm»); never user-configurable (no SSRF). */
export const FREELLM_BASE_URL = process.env.FREELLM_BASE_URL || 'http://freellmapi:3001/v1';

/**
 * Provider for IDEA suggestions only. With FreeLLMAPI enabled, ideas go to the free router first; any failure falls
 * back to the normal provider, so ideas never stop working. Everything else (brief/copy, posters, text checks) stays on
 * the main provider — free tiers are not reliable enough for published Arabic copy.
 */
export async function getIdeasProvider(s: Settings): Promise<AiProvider> {
  const main = await getAiProvider(s);
  if (override || main.isDryRun || !s.ai.freeLlm.enabled) return main;
  const key = await getSecret('FREELLM_API_KEY');
  if (!key) return main;
  const free = new OpenAiProvider(key, new (await import('openai')).default({ apiKey: key, baseURL: FREELLM_BASE_URL, timeout: 90_000, maxRetries: 0 }));
  return new Proxy(main, {
    get(target, prop, recv) {
      if (prop === 'name') return 'freellmapi';
      if (prop !== 'suggestIdeas') return Reflect.get(target, prop, recv);
      return async (req: Parameters<AiProvider['suggestIdeas']>[0], _model: string, count: number) => {
        try {
          const r = await free.suggestIdeas(req, s.ai.freeLlm.model || 'auto', count);
          if (!r.ideas.length) throw new Error('empty');
          // free tier: no OpenAI cost is recorded for these tokens
          return { ...r, model: `freellmapi:${r.model}`, usage: { inputTokens: 0, outputTokens: 0 } };
        } catch (e) {
          console.warn('[freellmapi] ideas failed, falling back to the main provider:', (e as Error).message);
          return target.suggestIdeas(req, s.ai.textModel, count);
        }
      };
    },
  });
}
