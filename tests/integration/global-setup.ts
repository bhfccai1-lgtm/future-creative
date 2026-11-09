import { execSync } from 'node:child_process';

/** Applies pending migrations (non-destructive) to the dedicated test database once per run. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://fc:fc@localhost:5432/fcap_test';
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
}
