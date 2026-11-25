import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * «Update the server» button. The app runs inside Docker and must never control the host (no Docker socket), so the
 * button only leaves a request file in the shared media volume. The host's update agent (cron, every minute — see
 * scripts/release-update.sh, switched on with `bash scripts/autoupdate.sh on …`) picks it up, runs scripts/update.sh
 * (GitHub CI guard, build while running, automatic rollback) and writes the result back here.
 */
// only the storage path (same default as env.ts) — a full env() validation failure must not hide the agent's files
const dir = () => path.join(path.resolve(process.env.LOCAL_STORAGE_DIR || './data/media'), '.system');
const REQUEST = 'update-request.json', STATUS = 'update-status.json', HEARTBEAT = 'agent-heartbeat';

export interface UpdateStatus { state: 'running' | 'ok' | 'fail'; at: string; version?: string; message?: string }
export interface ServerUpdateState {
  version: string;
  /** the host agent was seen in the last 3 minutes → a request is picked up within a minute */
  agentOnline: boolean;
  agentSeenAt: string | null;
  agentMode: string | null;
  pending: { by: string; at: string } | null;
  last: UpdateStatus | null;
}

const readJson = async <T>(f: string): Promise<T | null> => {
  try { return JSON.parse(await fs.readFile(path.join(dir(), f), 'utf8')) as T; } catch { return null; }
};

export async function serverUpdateState(now = Date.now()): Promise<ServerUpdateState> {
  let seen: string | null = null, mode: string | null = null;
  try { [seen, mode = null] = (await fs.readFile(path.join(dir(), HEARTBEAT), 'utf8')).trim().split(/\s+/); } catch { /* agent never ran */ }
  const seenMs = seen ? Date.parse(seen) : NaN;
  return {
    version: process.env.APP_VERSION ?? 'dev',
    agentOnline: Number.isFinite(seenMs) && now - seenMs < 3 * 60_000,
    agentSeenAt: Number.isFinite(seenMs) ? new Date(seenMs).toISOString() : null,
    agentMode: mode,
    pending: await readJson(REQUEST),
    last: await readJson(STATUS),
  };
}

export class UpdateBusyError extends Error {}

/** Leaves the update request for the host agent (one at a time; refused while an update is already running). */
export async function requestServerUpdate(by: string, now = new Date()): Promise<{ by: string; at: string }> {
  const s = await serverUpdateState(now.getTime());
  // a «running» status older than 45 min is stale (agent stopped mid-way) and no longer blocks
  if (s.last?.state === 'running' && now.getTime() - Date.parse(s.last.at) < 45 * 60_000) throw new UpdateBusyError('update already running');
  if (s.pending) return s.pending;
  const req = { by, at: now.toISOString() };
  await fs.mkdir(dir(), { recursive: true });
  await fs.writeFile(path.join(dir(), REQUEST), JSON.stringify(req));
  return req;
}
