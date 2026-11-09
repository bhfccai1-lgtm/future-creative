import IORedis, { type Redis } from 'ioredis';

let client: Redis | null = null;
/** Shared ioredis connection. maxRetriesPerRequest:null is required by BullMQ workers. */
export function redis(): Redis {
  if (!client) client = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null, lazyConnect: false });
  return client;
}
export function newRedisConnection(): Redis {
  return new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
}
export async function closeRedis() { if (client) { await client.quit().catch(() => undefined); client = null; } }
