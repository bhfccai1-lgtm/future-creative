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
