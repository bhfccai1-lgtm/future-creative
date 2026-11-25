import { describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('«تحديث الخادم» button ↔ host update agent', () => {
  it('leaves one request, sees the agent heartbeat, refuses while an update runs, and reads the result', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-upd-'));
    vi.stubEnv('LOCAL_STORAGE_DIR', dir);
    vi.resetModules();
    const { serverUpdateState, requestServerUpdate, UpdateBusyError } = await import('@/lib/ops/server-update');
    const sys = path.join(dir, '.system'), now = Date.parse('2026-11-25T20:00:00Z');

    let s = await serverUpdateState(now);
    expect(s).toMatchObject({ agentOnline: false, pending: null, last: null });

    await fs.mkdir(sys, { recursive: true });
    await fs.writeFile(path.join(sys, 'agent-heartbeat'), '2026-11-25T22:59:10+03:00 main\n'); // host clock, Bahrain offset
    s = await serverUpdateState(now);
    expect(s).toMatchObject({ agentOnline: true, agentMode: 'main' });
    expect((await serverUpdateState(now + 5 * 60_000)).agentOnline).toBe(false); // agent silent for minutes → not online

    const r1 = await requestServerUpdate('owner@x', new Date(now));
    const r2 = await requestServerUpdate('other@x', new Date(now + 1000));
    expect(r2).toEqual(r1); // one pending request, not a queue
    expect(JSON.parse(await fs.readFile(path.join(sys, 'update-request.json'), 'utf8'))).toEqual({ by: 'owner@x', at: new Date(now).toISOString() });

    // the agent took the request and is updating → the button refuses a second update
    await fs.rm(path.join(sys, 'update-request.json'));
    await fs.writeFile(path.join(sys, 'update-status.json'), JSON.stringify({ state: 'running', at: new Date(now).toISOString(), version: 'abc1234', message: '' }));
    await expect(requestServerUpdate('owner@x', new Date(now + 60_000))).rejects.toBeInstanceOf(UpdateBusyError);
    await expect(requestServerUpdate('owner@x', new Date(now + 50 * 60_000))).resolves.toMatchObject({ by: 'owner@x' }); // stale «running» no longer blocks

    await fs.writeFile(path.join(sys, 'update-status.json'), '{"state":"fail","at":"2026-11-25T20:05:05+00:00","version":"abc1234","message":"Update failed"}');
    expect((await serverUpdateState(now)).last).toMatchObject({ state: 'fail', version: 'abc1234' });
    vi.unstubAllEnvs();
    await fs.rm(dir, { recursive: true, force: true });
  });
});
