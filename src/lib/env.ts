import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  APP_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'APP_ENCRYPTION_KEY must be 32 bytes hex (64 chars)'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 chars'),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('./data/media'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  METRICOOL_API_TOKEN: z.string().optional(),
  METRICOOL_USER_ID: z.string().optional(),
  METRICOOL_BASE_URL: z.string().default('https://app.metricool.com/api'),
  FONT_DIR: z.string().default('./assets/fonts'),
  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  COOKIE_SECURE: z.string().optional(),
});

export type Env = z.infer<typeof schema>;
let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${msg}`);
  }
  cached = parsed.data;
  return cached;
}

export function resetEnvCache() { cached = null; }
