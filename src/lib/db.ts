import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/** Prisma 7: the client connects through the node-postgres driver adapter (the URL is no longer in schema.prisma). */
export function newPrismaClient(log: ('warn' | 'error')[] = ['warn', 'error']) {
  // no throw at import: like Prisma 6, nothing connects until the first query (the Docker build and the unit tests
  // import this module without a database)
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }), log });
}

const g = globalThis as unknown as { __prisma?: PrismaClient };
export const prisma: PrismaClient = g.__prisma ?? newPrismaClient();
if (process.env.NODE_ENV !== 'production') g.__prisma = prisma;
