import { describe, expect, it } from 'vitest';
import { explainInfraError } from '@/lib/errors';
import { errorResponse } from '@/lib/auth/server';

// shapes as Prisma 7 + @prisma/adapter-pg actually throw them (checked against a real database)
const adapter = (kind: string, originalCode: string, code = 'P2010') => Object.assign(new Error('Invalid `prisma.user.findUnique()` invocation'), {
  name: 'PrismaClientKnownRequestError', code, meta: { driverAdapterError: Object.assign(new Error(kind), { cause: { kind, originalCode } }) },
});

describe('server errors say what is wrong (no more bare «خطأ داخلي في الخادم»)', () => {
  it('classifies database down / not migrated / missing settings — codes and setting names only, never values', () => {
    expect(explainInfraError(adapter('DatabaseNotReachable', 'ECONNREFUSED'))?.code).toBe('DB_UNREACHABLE');
    expect(explainInfraError(adapter('AuthenticationFailed', '28P01'))?.code).toBe('DB_UNREACHABLE');
    expect(explainInfraError(Object.assign(new Error('x'), { cause: { code: 'ECONNREFUSED' } }))?.code).toBe('DB_UNREACHABLE');
    expect(explainInfraError(adapter('TableDoesNotExist', '42P01'))?.code).toBe('DB_NOT_MIGRATED');
    expect(explainInfraError(adapter('ColumnNotFound', '42703', 'P2022'))?.code).toBe('DB_NOT_MIGRATED');
    expect(explainInfraError(new Error('SESSION_SECRET is missing or shorter than 32 characters'))?.code).toBe('CONFIG_SESSION_SECRET');
    const env = explainInfraError(new Error('Invalid environment configuration: DATABASE_URL: Required; ENCRYPTION_KEY: too short'));
    expect(env?.code).toBe('CONFIG_ENV');
    expect(env?.message).toContain('DATABASE_URL، ENCRYPTION_KEY');
    expect(explainInfraError(new TypeError('Cannot read properties of undefined'))).toBeNull(); // real bugs stay «internal»
  });

  it('the API answers 503 with the reason (the login page shows it), a bug still 500', async () => {
    const r = errorResponse(adapter('DatabaseNotReachable', 'ECONNREFUSED'));
    expect(r.status).toBe(503);
    expect((await r.json()).message).toMatch(/قاعدة البيانات لا تستجيب.*DB_UNREACHABLE/);
    expect(errorResponse(new TypeError('x')).status).toBe(500);
  });
});
