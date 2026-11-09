import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from './env';

/** AES-256-GCM authenticated encryption for provider credentials / API keys stored at rest. */
export function encryptSecret(plain: string, keyHex = env().APP_ENCRYPTION_KEY): string {
  const key = Buffer.from(keyHex, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
}

export function decryptSecret(payload: string, keyHex = env().APP_ENCRYPTION_KEY): string {
  const [v, ivB, tagB, encB] = payload.split('.');
  if (v !== 'v1' || !ivB || !tagB || !encB) throw new Error('Malformed encrypted payload');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), Buffer.from(ivB, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encB, 'base64url')), decipher.final()]).toString('utf8');
}

export const sha256 = (buf: Buffer | string) => createHash('sha256').update(buf).digest('hex');

export function hmac(data: string, secret = env().SESSION_SECRET) {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Mask a secret for display: never return more than the last 4 chars. */
export const maskSecret = (s?: string | null) => (s ? `••••${s.slice(-4)}` : '');
