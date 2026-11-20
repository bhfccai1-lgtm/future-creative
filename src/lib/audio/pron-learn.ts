import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import type { AiProvider } from '../ai/types';
import type { Settings } from '../settings';
import { assertBudget, estimateTextCost, recordUsage } from '../ai/cost';
import { normalizeForCompare, sameWords } from './pronounce';

/**
 * «النطق الذكي»:
 *  - vocalising re-take: when the listen-back check misses words, one small AI text call adds FULL diacritics
 *    (tashkeel) to those words only; the result is used only if it has exactly the same words (verified)
 *  - learning: every missed word is counted (with the vocalised form when one was made) so the owner sees
 *    «كلمات يتعثر فيها الصوت» and adds them to the dictionary with one click — the next ads read them right
 */
const KEY = 'pron:missed';
export interface MissedWord { word: string; count: number; suggestion: string | null; last: string }

/** the fix() for speakVerified: null when there is no live text model */
export function vocaliseFix(provider: AiProvider, s: Settings) {
  if (provider.isDryRun || !provider.generateJson) return undefined;
  return async (script: string, missed: string[]): Promise<string | null> => {
    await assertBudget(s, estimateTextCost(s, 600, 300));
    const r = await provider.generateJson!([
      'You are an Arabic diacritisation (تشكيل) expert for a voice-over.',
      'Return the SAME text with FULL diacritics on the listed words (and on any word whose reading is ambiguous), in the dialect implied by the text (Gulf/Bahraini where colloquial).',
      'Do NOT add, remove, reorder or replace any word; keep punctuation. Return JSON {"text":"..."}.',
    ].join('\n'), JSON.stringify({ text: script, words: missed }), s.ai.textModel);
    await recordUsage({ provider: provider.name, model: r.model, kind: 'text', inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, costUsd: estimateTextCost(s, r.usage.inputTokens, r.usage.outputTokens) });
    const text = String((r.json as { text?: unknown })?.text ?? '').trim();
    return text && sameWords(text, script) ? text : null;
  };
}

/** the vocalised form of `word` inside `fixed` (aligned by the normalised word sequence) */
function vocalisedOf(word: string, script: string, fixed: string | null): string | null {
  if (!fixed) return null;
  const a = script.split(/\s+/).filter(Boolean), b = fixed.split(/\s+/).filter(Boolean);
  if (a.length !== b.length) return null;
  const target = normalizeForCompare(word).join(' ');
  const i = a.findIndex((w) => normalizeForCompare(w).join(' ') === target);
  return i >= 0 && b[i] !== a[i] ? b[i].replace(/[.,،!؟?]+$/, '') : null;
}

/** counts the missed words (and keeps the latest vocalised suggestion) */
export async function recordMissed(missed: string[], script: string, fixed: string | null, now = new Date()) {
  const words = [...new Set(missed.map((w) => w.replace(/[.,،!؟?«»"]+/g, '').trim()).filter((w) => w.length >= 2))].slice(0, 10);
  if (!words.length) return;
  const row = await prisma.systemSetting.findUnique({ where: { key: KEY } }).catch(() => null);
  const map = new Map(((row?.value as MissedWord[] | undefined) ?? []).map((m) => [m.word, m]));
  for (const w of words) {
    const prev = map.get(w);
    map.set(w, { word: w, count: (prev?.count ?? 0) + 1, suggestion: vocalisedOf(w, script, fixed) ?? prev?.suggestion ?? null, last: now.toISOString() });
  }
  const value = [...map.values()].sort((x, y) => y.count - x.count).slice(0, 200) as unknown as Prisma.InputJsonValue;
  await prisma.systemSetting.upsert({ where: { key: KEY }, create: { key: KEY, value, updatedBy: 'voice' }, update: { value, updatedBy: 'voice' } });
}

/** the words to offer the owner (not already in the dictionary), most frequent first */
export async function missedSuggestions(lexicon: { from: string }[], limit = 12): Promise<MissedWord[]> {
  const row = await prisma.systemSetting.findUnique({ where: { key: KEY } }).catch(() => null);
  const known = new Set(lexicon.map((e) => normalizeForCompare(e.from).join(' ')));
  return ((row?.value as MissedWord[] | undefined) ?? []).filter((m) => !known.has(normalizeForCompare(m.word).join(' '))).slice(0, limit);
}
