import { beforeEach, describe, expect, it, vi } from 'vitest';

// a real signed session for the route wrapper (api()) — the cookie store is the only thing faked
const jar: { token?: string } = {};
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => (n === 'fc_session' && jar.token ? { name: n, value: jar.token } : undefined) }),
}));
process.env.SESSION_SECRET ||= 'test-session-secret-0123456789-abcdefghijklmnop';

import { prisma } from '@/lib/db';
import { signSession } from '@/lib/auth/session';
import { generateAdvertisement } from '@/lib/pipeline/generate';
import { setAiProviderOverride } from '@/lib/ai';
import { setPublishingAdapterOverride } from '@/lib/publishing/registry';
import { POST } from '@/app/api/approvals/bulk/route';
import { captureQueues, FakeAdapter, FakeAiProvider, resetDb, seedBase } from './helpers';

const req = (body: unknown) => new Request('http://localhost/api/approvals/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(async () => { await resetDb(); captureQueues(); });

async function setup() {
  const base = await seedBase({ accounts: 2, settings: (s) => ({ ...s, publishingMode: 'MANUAL', ai: { ...s.ai, dryRun: false } }) });
  setAiProviderOverride(new FakeAiProvider()); setPublishingAdapterOverride(new FakeAdapter());
  const u = await prisma.user.findUniqueOrThrow({ where: { id: base.admin.id }, include: { role: true } });
  jar.token = await signSession({ sub: u.id, email: u.email, role: u.role.name, perms: u.role.permissions, sv: u.sessionVersion });
  const ads = [];
  for (const a of [base.accounts[0], base.accounts[1], base.accounts[0]]) ads.push((await generateAdvertisement({ accountId: a.id, createdBy: 'tester' })).advertisement);
  return { base, ads };
}

describe('approval queue: bulk decisions through the same checks as the single buttons', () => {
  it('bulk publish sends only designs that passed QC; a QC-failed one is skipped (never overridden in bulk)', async () => {
    const { ads } = await setup();
    // the third design has not passed QC — bulk must skip it
    await prisma.advertisement.update({ where: { id: ads[2].id }, data: { qcPassed: false } });
    const r = await POST(req({ action: 'publish', ids: ads.map((a) => a.id) }) as never, {} as never);
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j).toMatchObject({ done: 2, skipped: 1 });
    expect(j.message).toContain('لم يجتز فحص الجودة');
    expect(await prisma.publicationJob.count({ where: { primary: true } })).toBe(2);
    expect(await prisma.approvalRequest.count({ where: { advertisementId: ads[2].id, status: 'PENDING' } })).toBe(1); // still waiting for a person
    expect(await prisma.auditLog.count({ where: { action: 'approvals.bulk_publish' } })).toBe(1);
  });
  it('bulk reject records the reason on every design; already-decided ids are reported, not re-processed', async () => {
    const { ads } = await setup();
    const r1 = await POST(req({ action: 'reject', ids: [ads[0].id, ads[1].id], note: 'ألوان باهتة' }) as never, {} as never);
    expect((await r1.json()).done).toBe(2);
    expect(await prisma.approvalRequest.count({ where: { status: 'REJECTED', note: 'ألوان باهتة' } })).toBe(2);
    const r2 = await POST(req({ action: 'reject', ids: [ads[0].id, ads[2].id] }) as never, {} as never);
    const j2 = await r2.json();
    expect(j2.done).toBe(1);
    expect(j2.message).toContain('قُرّر مسبقًا');
  });
  it('rejects malformed requests', async () => {
    await setup();
    expect((await POST(req({ action: 'delete', ids: ['x'] }) as never, {} as never)).status).toBe(422); // the api() wrapper answers validation errors with 422
    expect((await POST(req({ action: 'publish', ids: [] }) as never, {} as never)).status).toBe(422); // the api() wrapper answers validation errors with 422
  });
});
