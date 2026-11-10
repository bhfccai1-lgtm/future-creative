import { describe, expect, it, beforeAll } from 'vitest';

beforeAll(() => {
  process.env.APP_ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.SESSION_SECRET = 'unit-test-session-secret-0123456789abcdef';
  process.env.DATABASE_URL = 'postgresql://x';
  process.env.PUBLIC_BASE_URL = 'https://ads.example.bh';
});

describe('encrypted secrets (AES-256-GCM)', () => {
  it('round-trips and never stores plaintext', async () => {
    const { encryptSecret, decryptSecret } = await import('@/lib/crypto');
    const enc = encryptSecret('sk-test-123', 'b'.repeat(64));
    expect(enc).not.toContain('sk-test');
    expect(decryptSecret(enc, 'b'.repeat(64))).toBe('sk-test-123');
  });
  it('detects tampering and wrong keys', async () => {
    const { encryptSecret, decryptSecret } = await import('@/lib/crypto');
    const enc = encryptSecret('secret', 'b'.repeat(64));
    const parts = enc.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decryptSecret(parts.join('.'), 'b'.repeat(64))).toThrow();
    expect(() => decryptSecret(enc, 'c'.repeat(64))).toThrow();
  });
});

describe('session tokens', () => {
  it('signs and verifies, rejects tampered tokens', async () => {
    const { signSession, verifySession } = await import('@/lib/auth/session');
    const t = await signSession({ sub: 'u1', email: 'a@b.c', role: 'ADMIN', perms: ['dashboard:view'], sv: 0 });
    expect((await verifySession(t))?.sub).toBe('u1');
    expect(await verifySession(t.slice(0, -3) + 'abc')).toBeNull();
    expect(await verifySession('garbage')).toBeNull();
  });
});

describe('RBAC', () => {
  it('viewer cannot publish or authorise autonomy; admin can', async () => {
    const { DEFAULT_ROLES, can } = await import('@/lib/auth/rbac');
    expect(can(DEFAULT_ROLES.VIEWER, 'publish:now')).toBe(false);
    expect(can(DEFAULT_ROLES.EDITOR, 'autonomy:authorize')).toBe(false);
    expect(can(DEFAULT_ROLES.ADMIN, 'autonomy:authorize')).toBe(true);
  });
});

describe('signed public media URLs', () => {
  it('verifies valid signatures and rejects expired / altered ones', async () => {
    const { signedMediaUrl, verifyMediaSignature } = await import('@/lib/storage');
    const now = Date.now();
    const u = new URL(signedMediaUrl('ads/a/b/final.jpg', 60, now));
    expect(u.pathname.endsWith('/final.jpg')).toBe(true); // providers detect the type from the extension
    const [, , , e, s, ...rest] = u.pathname.split('/');
    const k = rest.map(decodeURIComponent).join('/');
    expect(k).toBe('ads/a/b/final.jpg');
    expect(verifyMediaSignature(k, e, s, now)).toBe(true);
    expect(verifyMediaSignature('ads/other.jpg', e, s, now)).toBe(false);
    expect(verifyMediaSignature(k, e, s, now + 120_000)).toBe(false);
  });
});

describe('password policy', () => {
  it('requires length and mixed characters', async () => {
    const { passwordPolicyError } = await import('@/lib/auth/password');
    expect(passwordPolicyError('short1')).not.toBeNull();
    expect(passwordPolicyError('onlyletterslong')).not.toBeNull();
    expect(passwordPolicyError('Strong-Pass-2026')).toBeNull();
  });
});
