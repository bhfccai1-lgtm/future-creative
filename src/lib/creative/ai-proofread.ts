/**
 * AI PROOFREADING («مراجعة لغوية بالذكاء الاصطناعي», setting `ai.useAiReview`, off by default — it costs one small text
 * call per design): a language model reads the ad copy BEFORE the design is drawn and returns only definite spelling /
 * grammar / typo mistakes as exact «wrong → fix» pairs. A fix is applied only when it is safe: the wrong text appears
 * exactly once in that field, the fix is a small edit (not a rewrite), and it introduces no digits, prices or phone
 * numbers. Gulf dialect is NOT an error. Anything uncertain is shown to the reviewer instead of being applied.
 */
export const PROOF_FIELDS = ['headline', 'badge', 'supportingCopy', 'cta', 'caption'] as const;
export type ProofField = (typeof PROOF_FIELDS)[number];
export type ProofCopy = Partial<Record<ProofField, string>>;
export interface ProofIssue { field: ProofField; wrong: string; fix: string; reason: string }
export interface ProofResult { copy: ProofCopy; applied: ProofIssue[]; flagged: ProofIssue[] }

export const PROOF_SYSTEM = [
  'You are a meticulous proofreader for short social-media ads (Arabic — often Bahraini/Gulf dialect — or English).',
  'Report ONLY definite mistakes: misspelled words, wrong letters (ة/ه, ى/ي, hamza forms like أ/ا/إ when clearly wrong), repeated words, missing or doubled spaces inside a word, broken grammar, English typos.',
  'Gulf/Bahraini dialect words and spellings are CORRECT (e.g. «تبي», «وايد», «الحين», «هالهدية») — never "fix" dialect into formal Arabic. Do not change style, tone, emojis, hashtags, brand names or meaning. Do not suggest rewrites.',
  'Return JSON: {"issues":[{"field":"headline|badge|supportingCopy|cta|caption","wrong":"<the exact substring as written>","fix":"<the corrected substring>","reason":"<short reason in Arabic>"}]}. Return {"issues":[]} when there is nothing definite.',
].join('\n');

const lev = (a: string, b: string) => {
  const m = [...a], n = [...b]; let prev = Array.from({ length: n.length + 1 }, (_, i) => i);
  for (let i = 1; i <= m.length; i++) {
    const cur = [i];
    for (let j = 1; j <= n.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (m[i - 1] === n[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n.length];
};
const count = (hay: string, needle: string) => needle ? hay.split(needle).length - 1 : 0;

/** pure: validates the model's answer and applies only the safe fixes */
export function applyProofIssues(copy: ProofCopy, raw: unknown): ProofResult {
  const list = (raw as { issues?: unknown })?.issues;
  const out: ProofResult = { copy: { ...copy }, applied: [], flagged: [] };
  if (!Array.isArray(list)) return out;
  for (const it of list.slice(0, 12)) {
    const x = it as Partial<ProofIssue>;
    if (!x || !PROOF_FIELDS.includes(x.field as ProofField) || typeof x.wrong !== 'string' || typeof x.fix !== 'string') continue;
    const field = x.field as ProofField, wrong = x.wrong.trim(), fix = x.fix.trim();
    const issue: ProofIssue = { field, wrong, fix, reason: String(x.reason ?? '').slice(0, 120) };
    const text = out.copy[field];
    if (!text || !wrong || wrong === fix) continue;
    if (count(text, wrong) === 0) continue; // the model invented it — ignore
    const small = lev(wrong, fix) <= Math.max(2, Math.ceil([...wrong].length * 0.34));
    const digits = (t: string) => (t.match(/[0-9٠-٩]/g) ?? []).join('');
    const noNewNumbers = digits(fix) === digits(wrong);
    if (count(text, wrong) === 1 && small && noNewNumbers && fix.length > 0) { out.copy[field] = text.replace(wrong, fix); out.applied.push(issue); }
    else out.flagged.push(issue);
  }
  return out;
}

/** the reviewer-facing summary line for the QC report */
export function proofSummary(r: { applied: Omit<ProofIssue, 'field'>[]; flagged: Omit<ProofIssue, 'field'>[] }) {
  return [
    ...r.applied.map((i) => `صُحّح: «${i.wrong}» ← «${i.fix}»${i.reason ? ` (${i.reason})` : ''}`),
    ...r.flagged.map((i) => `للمراجعة: «${i.wrong}» ← «${i.fix}»${i.reason ? ` (${i.reason})` : ''}`),
  ].join('؛ ');
}
