/**
 * Structured JSON logger (one line per event) with correlation IDs and secret redaction.
 * Never log tokens, API keys, passwords or cookies: keys matching SECRET_KEY are masked and
 * values that look like bearer tokens / API keys are masked even under innocent keys.
 */
const SECRET_KEY = /(token|secret|password|passwd|api[-_]?key|authorization|auth|cookie|session|x-mc-auth|encrypted)/i;
const SECRET_VALUE = /\b(sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{12,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+)/g;

export function redact(v: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]';
  if (typeof v === 'string') return v.replace(SECRET_VALUE, '[REDACTED]').slice(0, 2000);
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => redact(x, depth + 1));
  if (v instanceof Error) return { name: v.name, message: redact(v.message, depth + 1) };
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = SECRET_KEY.test(k) ? '[REDACTED]' : redact(val, depth + 1);
    return out;
  }
  return v;
}

type Level = 'debug' | 'info' | 'warn' | 'error';
function emit(level: Level, event: string, fields: Record<string, unknown> = {}) {
  if (process.env.NODE_ENV === 'test' && level !== 'error' && !process.env.LOG_IN_TESTS) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...(redact(fields) as object) });
  (level === 'error' ? console.error : console.log)(line);
}

export const log = {
  debug: (e: string, f?: Record<string, unknown>) => emit('debug', e, f),
  info: (e: string, f?: Record<string, unknown>) => emit('info', e, f),
  warn: (e: string, f?: Record<string, unknown>) => emit('warn', e, f),
  error: (e: string, f?: Record<string, unknown>) => emit('error', e, f),
};
