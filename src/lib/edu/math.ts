/** Digits, equations and answer checks — numbers and operators never flip on export. */
const AR = '٠١٢٣٤٥٦٧٨٩';
export const toArabicDigits = (s: string) => s.replace(/[0-9]/g, (d) => AR[Number(d)]);
export const toLatinDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String(AR.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
export const withDigits = (s: string, style: 'arabic' | 'latin') => (style === 'arabic' ? toArabicDigits(toLatinDigits(s)) : toLatinDigits(s));

export type Token = { t: 'num'; v: string } | { t: 'op'; v: string } | { t: 'blank' };
/** «23 + 15 = ؟» / «٢٣ + ١٥ = __» → tokens; null when the text is not a simple equation. */
export function tokenize(raw: string): Token[] | null {
  const s = toLatinDigits(raw).replace(/\s+/g, ' ').trim();
  if (!/^[\d\s.+\-−×x*÷/=<>_؟?□]+$/.test(s) || !/\d/.test(s) || !/[+\-−×x*÷/<>=]/.test(s)) return null;
  const out: Token[] = [];
  const re = /(\d+(?:\.\d+)?)|([+\-−×x*÷/=<>])|(_+|؟|\?|□)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m[1]) out.push({ t: 'num', v: m[1] });
    else if (m[2]) out.push({ t: 'op', v: m[2] === '-' ? '−' : m[2] === '*' || m[2] === 'x' ? '×' : m[2] === '/' ? '÷' : m[2] });
    else out.push({ t: 'blank' });
  }
  return out.length >= 3 ? out : null;
}

/**
 * Visual order of an equation's tokens. Arabic school maths reads right-to-left: «٣ + ٤ = ٧» has ٣ on the RIGHT.
 * Tokens are drawn one by one left-to-right on the page, so for rtl we reverse them — numbers keep their own digit
 * order (٢٣ stays ٢٣), operators stay in place, nothing depends on the bidi algorithm of the exporter.
 */
export const visualOrder = (tokens: Token[], dir: 'rtl' | 'ltr') => (dir === 'rtl' ? [...tokens].reverse() : tokens);

const apply = (a: number, op: string, b: number) => (op === '+' ? a + b : op === '−' ? a - b : op === '×' ? a * b : op === '÷' ? (b === 0 ? NaN : a / b) : NaN);
/** Left side evaluated left-to-right with × ÷ before + −. */
export function evaluate(tokens: Token[]): number | null {
  const nums: number[] = []; const ops: string[] = [];
  for (const tk of tokens) { if (tk.t === 'num') nums.push(Number(tk.v)); else if (tk.t === 'op') ops.push(tk.v); else return null; }
  if (nums.length !== ops.length + 1 || ops.some((o) => !'+−×÷'.includes(o))) return null;
  const n = [nums[0]]; const o: string[] = [];
  for (let i = 0; i < ops.length; i++) {
    if (ops[i] === '×' || ops[i] === '÷') n[n.length - 1] = apply(n[n.length - 1], ops[i], nums[i + 1]);
    else { o.push(ops[i]); n.push(nums[i + 1]); }
  }
  let r = n[0]; for (let i = 0; i < o.length; i++) r = apply(r, o[i], n[i + 1]);
  return Number.isFinite(r) ? Math.round(r * 1e6) / 1e6 : null;
}

/**
 * Checks a worked statement «a op b = c» (or an exercise question «a op b = __» against its answer).
 * Returns null when it is not arithmetic we can check (then a human reviews it).
 */
export function checkStatement(statement: string, answer?: string): { ok: boolean; expected: number; got: number } | null {
  const tk = tokenize(statement);
  if (!tk) return null;
  const eq = tk.findIndex((x) => x.t === 'op' && x.v === '=');
  if (eq <= 0) return null;
  const left = tk.slice(0, eq), right = tk.slice(eq + 1);
  const expected = evaluate(left);
  if (expected === null) return null;
  let got: number | null = null;
  if (right.length === 1 && right[0].t === 'num') got = Number(right[0].v);
  else if (right.length === 1 && right[0].t === 'blank' && answer !== undefined && answer.trim()) { const a = toLatinDigits(answer).match(/-?\d+(\.\d+)?/); got = a ? Number(a[0]) : null; }
  if (got === null) return null;
  return { ok: Math.abs(got - expected) < 1e-6, expected, got };
}

/** Deterministic grade-appropriate addition/subtraction drills (answers computed, never guessed). */
export function arithmeticDrill(count: number, grade: number, seed = 1, ops: ('+' | '−')[] = ['+', '−']) {
  let x = seed * 9301 + 49297; const rnd = () => { x = (x * 9301 + 49297) % 233280; return x / 233280; };
  const max = grade <= 1 ? 10 : grade === 2 ? 50 : grade === 3 ? 100 : 1000;
  const out: { q: string; answer: string }[] = [];
  for (let i = 0; i < count; i++) {
    const op = ops[i % ops.length];
    let a = 1 + Math.floor(rnd() * (max - 1)), b = 1 + Math.floor(rnd() * (max - 1));
    if (op === '−' && b > a) [a, b] = [b, a];
    if (op === '+' && a + b > max) b = Math.max(1, max - a);
    out.push({ q: `${a} ${op} ${b} = __`, answer: String(op === '+' ? a + b : a - b) });
  }
  return out;
}
