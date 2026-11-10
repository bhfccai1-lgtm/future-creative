import { promises as fs } from 'node:fs';
import path from 'node:path';
import { GetObjectCommand, PutObjectCommand, S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { env } from '../env';
import { hmac, safeEqual } from '../crypto';

export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
}

class LocalStorage implements Storage {
  constructor(private root: string) {}
  private p(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Invalid storage key');
    return full;
  }
  async put(key: string, body: Buffer) { const f = this.p(key); await fs.mkdir(path.dirname(f), { recursive: true }); await fs.writeFile(f, body); }
  async get(key: string) { return fs.readFile(this.p(key)); }
  async exists(key: string) { try { await fs.access(this.p(key)); return true; } catch { return false; } }
}

class S3Storage implements Storage {
  private client: S3Client; private bucket: string;
  constructor() {
    const e = env();
    if (!e.S3_BUCKET) throw new Error('S3_BUCKET is required when STORAGE_DRIVER=s3');
    this.bucket = e.S3_BUCKET;
    this.client = new S3Client({
      region: e.S3_REGION, endpoint: e.S3_ENDPOINT, forcePathStyle: e.S3_FORCE_PATH_STYLE === 'true',
      credentials: e.S3_ACCESS_KEY_ID ? { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY ?? '' } : undefined,
    });
  }
  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }
  async get(key: string) {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  async exists(key: string) {
    try { await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key })); return true; } catch { return false; }
  }
}

let instance: Storage | null = null;
export function storage(): Storage {
  if (instance) return instance;
  const e = env();
  instance = e.STORAGE_DRIVER === 's3' ? new S3Storage() : new LocalStorage(path.resolve(e.LOCAL_STORAGE_DIR));
  return instance;
}
export function setStorageForTests(s: Storage) { instance = s; }

/**
 * Time-limited signed public URL so a publishing provider can download finished media
 * without exposing the admin media endpoint. Served by /api/public-media.
 */
export function signedMediaUrl(key: string, ttlSeconds = 7 * 24 * 3600, now = Date.now()) {
  const exp = Math.floor(now / 1000) + ttlSeconds;
  const sig = hmac(`media:${key}:${exp}`);
  // Path-style URL that ENDS with the real file name/extension (…/final.jpg, …/reel.mp4):
  // publishing providers detect the media type from the URL and re-host it.
  const u = new URL(`/api/m/${exp}/${sig}/${key.split('/').map(encodeURIComponent).join('/')}`, env().PUBLIC_BASE_URL);
  return u.toString();
}

export function verifyMediaSignature(key: string, exp: string, sig: string, now = Date.now()) {
  const e = Number(exp);
  if (!Number.isFinite(e) || e * 1000 < now) return false;
  return safeEqual(hmac(`media:${key}:${e}`), sig);
}

export const contentTypeFor = (key: string) =>
  key.endsWith('.png') ? 'image/png' : key.endsWith('.jpg') || key.endsWith('.jpeg') ? 'image/jpeg' : key.endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream';
