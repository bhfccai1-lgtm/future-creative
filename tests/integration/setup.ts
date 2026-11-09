import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';

// Isolated test database + storage. Never points at the production database.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://fc:fc@localhost:5432/fcap_test';
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15';
process.env.APP_ENCRYPTION_KEY = 'd'.repeat(64);
process.env.SESSION_SECRET = 'integration-test-secret-0123456789abcdefgh';
process.env.PUBLIC_BASE_URL = 'https://ads.test.local';
process.env.STORAGE_DRIVER = 'local';
process.env.LOCAL_STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), 'fc-it-media-'));
process.env.OPENAI_API_KEY = '';
process.env.METRICOOL_API_TOKEN = '';
