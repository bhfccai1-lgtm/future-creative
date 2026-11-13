import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

const req = (path: string, len: number, type = 'application/json') => new NextRequest(`https://ads.test.local${path}`, { method: 'POST', headers: { 'content-length': String(len), 'content-type': type } });

describe('request size limits (before parsing/validation)', () => {
  it('rejects oversized JSON everywhere — including token-authenticated integration endpoints', async () => {
    expect((await middleware(req('/api/integrations/n8n/generate', 2 * 1024 * 1024))).status).toBe(413);
    expect((await middleware(req('/api/ads/generate', 5 * 1024 * 1024))).status).toBe(413);
  });
  it('allows normal JSON and larger file uploads', async () => {
    expect((await middleware(req('/api/integrations/n8n/generate', 2000))).status).not.toBe(413);
    expect((await middleware(req('/api/brand/logo', 8 * 1024 * 1024, 'multipart/form-data; boundary=x'))).status).not.toBe(413);
    expect((await middleware(req('/api/brand/logo', 80 * 1024 * 1024, 'multipart/form-data; boundary=x'))).status).toBe(413);
  });
});
