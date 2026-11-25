export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400, public details?: unknown) {
    super(message);
  }
}
export class BudgetExceededError extends AppError {
  constructor(message: string) { super('BUDGET_EXCEEDED', message, 402); }
}
export class KillSwitchError extends AppError {
  constructor() { super('KILL_SWITCH_ACTIVE', 'Global kill switch is active — all publishing is halted', 423); }
}
export class ConfigurationError extends AppError {
  constructor(message: string) { super('CONFIGURATION_MISSING', message, 412); }
}

/**
 * Infrastructure failures explained in plain words instead of «خطأ داخلي في الخادم»: the owner sees on the page
 * itself (even on the login screen) whether the database is down, not updated, or a setting is missing — so a
 * screenshot is enough to fix it. Only codes and setting NAMES are shown, never values or connection strings.
 */
export interface InfraExplanation { code: string; message: string; status: number }
const DB_DOWN = /^(P100[0-2]|P1008|P1017|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|28P01|28000|3D000|57P0[1-3]|53300)$/;
const DB_SCHEMA = /^(P2021|P2022|42P01|42703|42704)$/;
const KINDS_DOWN = /DatabaseNotReachable|DatabaseDoesNotExist|AuthenticationFailed|ConnectionClosed|TooManyConnections|SocketTimeout/i;
const KINDS_SCHEMA = /TableDoesNotExist|ColumnNotFound/i;

function walk(e: unknown, seen = new Set<unknown>()): { codes: string[]; text: string } {
  const out = { codes: [] as string[], text: '' };
  const visit = (x: unknown, depth: number) => {
    if (!x || typeof x !== 'object' || seen.has(x) || depth > 6) return;
    seen.add(x);
    const o = x as Record<string, unknown>;
    for (const k of ['code', 'originalCode', 'kind', 'errno']) if (typeof o[k] === 'string') out.codes.push(o[k] as string);
    for (const k of ['name', 'message']) if (typeof o[k] === 'string') out.text += ` ${o[k]}`;
    for (const k of ['cause', 'meta', 'driverAdapterError', 'errors']) {
      const v = o[k];
      if (Array.isArray(v)) v.forEach((y) => visit(y, depth + 1)); else visit(v, depth + 1);
    }
  };
  visit(e, 0);
  return out;
}

export function explainInfraError(e: unknown): InfraExplanation | null {
  const { codes, text } = walk(e);
  if (/SESSION_SECRET/.test(text)) return { code: 'CONFIG_SESSION_SECRET', status: 503, message: 'إعداد ناقص في الخادم: SESSION_SECRET غير موجود أو قصير في ملف ‎.env‎ (CONFIG_SESSION_SECRET)' };
  const env = /Invalid environment configuration: (.*)/.exec(text);
  if (env) {
    const names = [...new Set([...env[1].matchAll(/([A-Z][A-Z0-9_]{2,}):/g)].map((m) => m[1]))].slice(0, 5).join('، ');
    return { code: 'CONFIG_ENV', status: 503, message: `إعداد ناقص أو خاطئ في ملف ‎.env‎ على الخادم${names ? `: ${names}` : ''} (CONFIG_ENV)` };
  }
  if (codes.some((c) => DB_SCHEMA.test(c) || KINDS_SCHEMA.test(c)) || /does not exist in the current database|relation .* does not exist|column .* does not exist/i.test(text))
    return { code: 'DB_NOT_MIGRATED', status: 503, message: 'تحديث قاعدة البيانات لم يكتمل (جدول أو عمود ناقص) — شغّل على الخادم: bash scripts/update.sh (DB_NOT_MIGRATED)' };
  if (codes.some((c) => DB_DOWN.test(c) || KINDS_DOWN.test(c)) || /PrismaClientInitializationError|Can't reach database|connect ECONNREFUSED|Connection terminated|password authentication failed/i.test(text))
    return { code: 'DB_UNREACHABLE', status: 503, message: 'قاعدة البيانات لا تستجيب — على الخادم: docker compose up -d ثم أعد المحاولة بعد دقيقة (DB_UNREACHABLE)' };
  return null;
}
