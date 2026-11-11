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
  it('5xx/404 (n8n workflow inactive) are retried with backoff; permanent 4xx (401/403/410/…) goes DEAD', async () => {
    await seedBase(); await enable();
    await emitEvent('publication.failed', {}); await emitEvent('connection.lost', {}); await emitEvent('publication.unknown', {});
    let n = 0;
    const flaky = (async () => { n++; return new Response('x', { status: n === 1 ? 503 : n === 2 ? 404 : 410 }); }) as unknown as typeof fetch;
    expect(await deliverPending(flaky)).toEqual({ delivered: 0, failed: 3 });
    const rows = await prisma.webhookDelivery.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => r.status)).toEqual(['PENDING', 'PENDING', 'DEAD']);
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

describe('n8n professional features', () => {
  it('Idempotency-Key: an n8n retry returns the first response and queues ONE design', async () => {
    const { accounts } = await seedBase(); await setSecret('N8N_API_TOKEN', 'tok-123'); await enable();
    const mk = () => { const r = req('/api/integrations/n8n/generate', { accountId: accounts[0].id, direction: { idea: 'فكرة' } }); r.headers.set('Idempotency-Key', 'sheet-row-7'); return r; };
    const a = await generatePOST(mk(), {} as never); const b = await generatePOST(mk(), {} as never);
    expect(a.status).toBe(202); expect(b.status).toBe(202);
    expect(b.headers.get('Idempotent-Replay')).toBe('true');
    expect((await b.json()).jobId).toBe((await a.json()).jobId);
    expect(captured.generate).toHaveLength(1);
  });
  it('lists pending designs with signed previews, reads one design, and catches up on missed events', async () => {
    const { GET: adsGET } = await import('@/app/api/integrations/n8n/ads/route');
    const { GET: adGET } = await import('@/app/api/integrations/n8n/ads/[id]/route');
    const { GET: delGET } = await import('@/app/api/integrations/n8n/deliveries/route');
    const { accounts } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false } }) });
    setAiProviderOverride(new FakeAiProvider()); await setSecret('N8N_API_TOKEN', 'tok-123'); await enable();
    const ad = (await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't' })).advertisement;
    const list = await (await adsGET(req('/api/integrations/n8n/ads?state=QUALITY_REVIEW'), {} as never)).json();
    expect(list[0]).toMatchObject({ id: ad.id, state: 'QUALITY_REVIEW' });
    expect(['PASS', 'NEEDS_REVIEW']).toContain(list[0].qc); // advisory warnings (e.g. caption quality) give NEEDS_REVIEW
    expect(list[0].imageUrl).toMatch(/\/api\/m\/\d+\/.+\.jpg$/);
    const one = await (await adGET(req(`/api/integrations/n8n/ads/${ad.id}`), { params: Promise.resolve({ id: ad.id }) })).json();
    expect(one.media).toHaveLength(1); expect(one.qc.failed.every((c: { severity: string }) => c.severity === 'WARNING')).toBe(true);
    const log = await (await delGET(req('/api/integrations/n8n/deliveries?event=ad.ready_for_review'), {} as never)).json();
    expect(log[0]).toMatchObject({ event: 'ad.ready_for_review', payload: { data: { adId: ad.id } } });
  });
  it('account pause from n8n is off by default; when allowed it holds publishing for that account', async () => {
    const { POST: pausePOST } = await import('@/app/api/integrations/n8n/accounts/[id]/pause/route');
    const { accounts } = await seedBase(); await setSecret('N8N_API_TOKEN', 'tok-123'); await enable();
    const call = () => pausePOST(req(`/api/integrations/n8n/accounts/${accounts[0].id}/pause`, { paused: true, by: 'owner', reason: 'تيليجرام' }), { params: Promise.resolve({ id: accounts[0].id }) });
    expect((await call()).status).toBe(403);
    await enable({ allowInboundControl: true });
    expect((await call()).status).toBe(200);
    expect((await prisma.socialAccount.findUniqueOrThrow({ where: { id: accounts[0].id } })).paused).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: 'account.pause', actorLabel: 'n8n:owner' } })).toBe(1);
  });
  it('new warnings become system.alert events (no duplicates for codes with a dedicated event)', async () => {
    const { notify } = await import('@/lib/audit');
    await seedBase(); await enable({ events: ['system.alert', 'publication.failed'] });
    await notify('WARNING', 'BUDGET_THRESHOLD', 'اقتراب من حد الإنفاق', '80%');
    await notify('WARNING', 'BUDGET_THRESHOLD', 'اقتراب من حد الإنفاق', '80%'); // deduplicated notification → no 2nd event
    await notify('ERROR', 'PUBLISH_FAILED', 'فشل النشر', 'x'); // has its own event → not bridged
    const ev = await prisma.webhookDelivery.findMany({ where: { event: 'system.alert' } });
    expect(ev).toHaveLength(1);
    expect((ev[0].payload as { data: { code: string } }).data.code).toBe('BUDGET_THRESHOLD');
  });
  it('approval reminders fire once per waiting design; the daily digest summarises the day', async () => {
    const { runApprovalReminders, buildDailyDigest } = await import('@/lib/integrations/digest');
    const { redis } = await import('@/lib/queue/connection');
    for (const k of await redis().keys('fc:n8n:reminded:*')) await redis().del(k);
    const { accounts } = await seedBase({ settings: (s) => ({ ...s, ai: { ...s.ai, dryRun: false } }) });
    setAiProviderOverride(new FakeAiProvider()); await enable({ events: ['approvals.reminder', 'daily.digest'] });
    await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't' });
    await prisma.approvalRequest.updateMany({ data: { createdAt: new Date(Date.now() - 8 * 3600_000) } });
    expect(await runApprovalReminders()).toEqual({ reminded: 1 });
    expect(await runApprovalReminders()).toEqual({ reminded: 0 });
    const d = await buildDailyDigest();
    expect(d).toMatchObject({ created: 1, pendingApprovals: 1, failed: 0 });
  });
});
