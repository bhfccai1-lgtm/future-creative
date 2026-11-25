import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Prisma 7 no longer reads .env by itself: load it for local CLI use (docker compose and CI pass the variables directly)
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  // optional on purpose: `prisma generate` (Docker build) runs without a database; migrate/diff commands need it
  datasource: { url: process.env.DATABASE_URL },
});
