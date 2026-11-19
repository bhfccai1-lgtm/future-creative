import type { AiProvider } from '../ai/types';
import type { Settings } from '../settings';
import { assertBudget, estimateImageCost, estimateTextCost, recordUsage } from '../ai/cost';
import { assessImage, retryHint, type ImageQuality } from './image-quality';

/**
 * Generates a picture and passes it through the quality gate (text inside, softness, cut-out margins).
 * A failed picture is regenerated with the reason added to the prompt — at most `retries` times and only while the
 * monthly AI budget allows; every image and every vision check is recorded as AI usage. The best attempt is returned.
 */
export interface CheckedImage { png: Buffer; model: string; quality: ImageQuality; attempts: number }
type GenOpts = Parameters<AiProvider['generateScene']>[1];

export async function generateChecked(provider: AiProvider, s: Settings, prompt: string, opts: GenOpts, o: { transparent?: boolean; retries?: number } = {}): Promise<CheckedImage> {
  const retries = o.retries ?? 1;
  const readText = provider.readText && !provider.isDryRun ? async (jpeg: Buffer) => {
    const r = await provider.readText!(jpeg, s.ai.textModel);
    await recordUsage({ provider: provider.name, model: r.model, kind: 'text', inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, costUsd: estimateTextCost(s, r.usage.inputTokens, r.usage.outputTokens) });
    return r.text;
  } : null;
  let best: CheckedImage | null = null, p = prompt;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    if (attempt > 1) { try { await assertBudget(s, estimateImageCost(s, opts.quality)); } catch { break; } }
    const img = await provider.generateScene(p, { ...opts, seedHint: `${opts.seedHint}:a${attempt}` });
    await recordUsage({ provider: provider.name, model: img.model, kind: 'image', images: 1, costUsd: estimateImageCost(s, opts.quality) });
    const quality = await assessImage(img.png, { transparent: o.transparent, readText });
    const cand = { png: img.png, model: img.model, quality, attempts: attempt };
    if (!best || quality.score > best.quality.score) best = cand;
    if (quality.pass) return cand;
    p = prompt + retryHint(quality);
  }
  return { ...best!, attempts: Math.min(retries + 1, best!.attempts > 0 ? retries + 1 : 1) };
}

/** short, stored summary of a picture's quality (shown in the studio) */
export const qualitySummary = (q: ImageQuality, extra: { judge?: number; attempts?: number } = {}) =>
  JSON.stringify({ score: q.score, pass: q.pass, sharp: q.sharpness, issues: q.issues.map((i) => ({ l: i.level, t: i.ar })), ...(extra.judge !== undefined ? { judge: extra.judge } : {}), ...(extra.attempts ? { attempts: extra.attempts } : {}) });
