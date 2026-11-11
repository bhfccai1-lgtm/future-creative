import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { updateSettings, setSecret } from '@/lib/settings';
import { emitEvent, deliverPending, sign } from '@/lib/integrations/events';
import { generateAdvertisement } from '@/lib/pipeline/generate';
import { setAiProviderOverride } from '@/lib/ai';
import { captured, captureQueues, FakeAiProvider, resetDb, seedBase } from './helpers';
import { POST as generatePOST } from '@/app/api/integrations/n8n/generate/route';
import { POST as decisionPOST } from '@/app/api/integrations/n8n/ads/[id]/decision/route';
import { GET as accountsGET } from '@/app/api/integrations/n8n/accounts/route';

beforeEach(async () => { await resetDb(); captureQueues(); });
const enable = (extra: Record<string, unknown> = {}) => updateSettings((s) => ({ ...s, n8n: { ...s.n8n, enabled: true, webhookUrl: 'http://n8n:5678/webhook/future-creative', ...extra } }));
const req = (url: string, body?: unknown, token = 'tok-123') => new Request(`http://web:3000${url}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

describe('n8n outbound events (durable, signed, retried)', () => {
  it('nothing is queued while disabled; enabled + subscribed events are signed and delivered', async () => {
    await seedBase();
    expect(await emitEvent('publication.failed', { x: 1 })).toBeNull();
    await enable(); await setSecret('N8N_WEBHOOK_SECRET', 'whs');
    expect(await emitEvent('ad.approved', {})).toBeNull(); // not subscribed by default
    await emitEvent('publication.failed', { reason: 'test' });
    const seen: { headers: Headers; body: string }[] = [];
    const fake = (async (_u: string, init: RequestInit) => { seen.push({ headers: new Headers(init.headers), body: String(init.body) }); return new Response('ok', { status: 200 }); }) as unknown as typeof fetch;
    expect(await deliverPending(fake)).toEqual({ delivered: 1, failed: 0 });
    const h = seen[0].headers;
    expect(h.get('x-fc-signature')).toBe(sign('whs', h.get('x-fc-timestamp')!, seen[0].body));
    expect(JSON.parse(seen[0].body)).toMatchObject({ event: 'publication.failed', data: { reason: 'test' } });
    expect(await prisma.webhookDelivery.count({ where: { status: 'DELIVERED' } })).toBe(1);
  });
  it('5xx/network errors are retried with backoff; 4xx (except 408/429) goes DEAD', async () => {
    await seedBase(); await enable();
    await emitEvent('publication.failed', {}); await emitEvent('connection.lost', {});
    let n = 0;
    const flaky = (async () => { n++; return new Response('x', { status: n === 1 ? 503 : 404 }); }) as unknown as typeof fetch;
    expect(await deliverPending(flaky)).toEqual({ delivered: 0, failed: 2 });
    const rows = await prisma.webhookDelivery.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => r.status)).toEqual(['PENDING', 'DEAD']);
    expect(rows[0].nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });
  it('a new design emits ad.ready_for_review with a signed image link', async () => {
    const { accounts } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false } }) });
    setAiProviderOverride(new FakeAiProvider()); await enable();
    await generateAdvertisement({ accountId: accounts[0].id, createdBy: 'tester' });
    const ev = await prisma.webhookDelivery.findFirstOrThrow({ where: { event: 'ad.ready_for_review' } });
    expect((ev.payload as { data: { imageUrl: string } }).data.imageUrl).toMatch(/^https:\/\/ads\.test\.local\/api\/m\/\d+\/.+\.jpg$/);
  });
});

describe('n8n inbound API (bearer token)', () => {
  it('rejects when disabled or with a wrong token; lists accounts with the right token', async () => {
    await seedBase(); await setSecret('N8N_API_TOKEN', 'tok-123');
    expect((await accountsGET(req('/api/integrations/n8n/accounts'), {} as never)).status).toBe(403);
    await enable();
    expect((await accountsGET(req('/api/integrations/n8n/accounts', undefined, 'wrong'), {} as never)).status).toBe(401);
    const ok = await accountsGET(req('/api/integrations/n8n/accounts'), {} as never);
    expect(ok.status).toBe(200); expect((await ok.json()).length).toBe(2);
  });
  it('generate queues a design for the approval queue (no publishing)', async () => {
    const { accounts } = await seedBase(); await setSecret('N8N_API_TOKEN', 'tok-123'); await enable();
    const r = await generatePOST(req('/api/integrations/n8n/generate', { accountId: accounts[0].id, direction: { idea: 'كوب تخرج بصورة الخريج' } }), {} as never);
    expect(r.status).toBe(202);
    expect(captured.generate[0].data).toMatchObject({ accountId: accounts[0].id, createdBy: 'n8n', direction: { idea: 'كوب تخرج بصورة الخريج' } });
  });
  it('approvals via n8n are off by default; when allowed they use the same guarded approval (SHA-256 bound)', async () => {
    const { accounts } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false } }) });
    setAiProviderOverride(new FakeAiProvider()); await setSecret('N8N_API_TOKEN', 'tok-123'); await enable();
    const ad = (await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't' })).advertisement;
    const call = () => decisionPOST(req(`/api/integrations/n8n/ads/${ad.id}/decision`, { decision: 'approve', by: 'owner' }), { params: Promise.resolve({ id: ad.id }) });
    expect((await call()).status).toBe(403);
    await enable({ allowInboundApprovals: true });
    const ok = await call();
    expect(ok.status).toBe(200); expect((await ok.json()).state).toBe('APPROVED');
    const appr = await prisma.approvalRequest.findFirstOrThrow({ where: { advertisementId: ad.id, status: 'APPROVED' } });
    expect(appr.mediaSha256).toBeTruthy();
    expect(await prisma.auditLog.count({ where: { action: 'ad.approve', actorLabel: 'n8n:owner' } })).toBe(1);
  });
});
