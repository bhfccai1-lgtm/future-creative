import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/** Prisma 7: the client connects through the node-postgres driver adapter (the URL is no longer in schema.prisma). */
export function newPrismaClient(log: ('warn' | 'error')[] = ['warn', 'error']) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return new PrismaClient({ adapter: new PrismaPg(url), log });
}

const g = globalThis as unknown as { __prisma?: PrismaClient };
export const prisma: PrismaClient = g.__prisma ?? newPrismaClient();
if (process.env.NODE_ENV !== 'production') g.__prisma = prisma;
