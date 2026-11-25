import { beforeEach, describe, expect, it, vi } from 'vitest';

// a real signed session for the route wrapper (api()) — the cookie store is the only thing faked
const jar = vi.hoisted(() => ({ token: '' }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => (n === 'fc_session' && jar.token ? { name: n, value: jar.token } : undefined) }),
  headers: async () => new Headers(),
}));
process.env.SESSION_SECRET ||= 'test-session-secret-0123456789-abcdefghijklmnop';

import { prisma } from '@/lib/db';
import { signSession } from '@/lib/auth/session';
import { getSecret, getSettings } from '@/lib/settings';
import { GET, POST, PUT } from '@/app/api/settings/google-archive/route';
import { resetDb, seedBase } from './helpers';

const FOLDER = 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUv';
const SHEET = 'https://docs.google.com/spreadsheets/d/1ZyXwVuTsRqPoNmLkJiHgFeDcBa/edit#gid=0';
const EXEC = 'https://script.google.com/macros/s/AKfycbTESTTESTTESTTESTTEST/exec';
const ctx = { params: Promise.resolve({}) };
const req = (method: string, body?: unknown, q = '') => new Request(`http://localhost/api/settings/google-archive${q}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });

beforeEach(async () => {
  await resetDb();
  const { admin } = await seedBase();
  const u = await prisma.user.findUniqueOrThrow({ where: { id: admin.id }, include: { role: true } });
  jar.token = await signSession({ sub: u.id, email: u.email, role: u.role.name, perms: u.role.permissions, sv: u.sessionVersion });
  vi.unstubAllGlobals();
});

describe('Google archive settings — saved, restored, verified', () => {
  it('folder + sheet links are validated, saved in the database and come back when the page reopens', async () => {
    const bad = await PUT(req('PUT', { folder: 'not a link', sheet: SHEET }), ctx);
    expect(bad.status).toBe(422);
    const r = await PUT(req('PUT', { folder: FOLDER, sheet: SHEET }), ctx);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toMatchObject({ saved: true, folderUrl: 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUv', sheetUrl: 'https://docs.google.com/spreadsheets/d/1ZyXwVuTsRqPoNmLkJiHgFeDcBa' });
    expect((await getSettings()).googleArchive).toMatchObject({ folderId: '1AbCdEfGhIjKlMnOpQrStUv', sheetId: '1ZyXwVuTsRqPoNmLkJiHgFeDcBa' });
    // reopening the page: GET returns what the database holds
    expect(await (await GET(req('GET'), ctx)).json()).toMatchObject({ folderUrl: j.folderUrl, sheetUrl: j.sheetUrl, configured: false, latestVersion: 4 });
  });

  it('the script is generated for the SAVED links with this system’s auth key; a /dev link is refused', async () => {
    expect((await GET(req('GET', undefined, '?script=1'), ctx)).status).toBe(422); // links not saved yet
    await PUT(req('PUT', { folder: FOLDER, sheet: SHEET }), ctx);
    const { script } = await (await GET(req('GET', undefined, '?script=1'), ctx)).json();
    const key = await getSecret('GOOGLE_ARCHIVE_KEY');
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(script).toContain(`const AUTH_KEY = '${key}';`);
    expect(script).toContain("const FOLDER_ID = '1AbCdEfGhIjKlMnOpQrStUv';");
    expect((await PUT(req('PUT', { url: EXEC.replace('/exec', '/dev') }), ctx)).status).toBe(422);
    const saved = await (await PUT(req('PUT', { url: EXEC }), ctx)).json();
    expect(saved).toMatchObject({ saved: true, configured: true });
  });

  it('the test sends the key, records the connected version + folder/sheet names, and explains each failure', async () => {
    await PUT(req('PUT', { folder: FOLDER, sheet: SHEET }), ctx);
    await PUT(req('PUT', { url: EXEC }), ctx);
    let sent: { key?: string; event?: string } = {};
    const answer = (o: unknown) => vi.stubGlobal('fetch', vi.fn(async (_u: string, init: { body: string }) => { sent = JSON.parse(init.body); return new Response(typeof o === 'string' ? o : JSON.stringify(o)); }));
    answer({ ok: true, version: 4, folderId: '1AbCdEfGhIjKlMnOpQrStUv', sheetId: '1ZyXwVuTsRqPoNmLkJiHgFeDcBa', folder: 'أرشيف المطبعة', sheet: 'سجل المنشورات' });
    const ok = await (await POST(req('POST', {}), ctx)).json();
    expect(sent).toMatchObject({ event: 'test.ping', key: await getSecret('GOOGLE_ARCHIVE_KEY') });
    expect(ok.lastTest).toMatchObject({ ok: true, version: 4, folderName: 'أرشيف المطبعة', sheetName: 'سجل المنشورات' });
    expect((await getSettings()).googleArchive.lastTest?.ok).toBe(true); // stored → shown when the page reopens
    // an old script, a wrong key, a page instead of JSON, a script made for other links
    answer({ ok: true, version: 3 });
    expect((await (await POST(req('POST', {}), ctx)).json()).lastTest).toMatchObject({ ok: false, version: 3 });
    answer({ ok: false, error: 'unauthorized' });
    expect((await POST(req('POST', {}), ctx)).status).toBe(502);
    expect((await getSettings()).googleArchive.lastTest?.message).toMatch(/مفتاح المصادقة/);
    answer('<html>Sign in</html>');
    expect((await POST(req('POST', {}), ctx)).status).toBe(502);
    expect((await getSettings()).googleArchive.lastTest?.message).toMatch(/Anyone/);
    answer({ ok: true, version: 4, folderId: 'OTHER-FOLDER-0000000000', sheetId: '1ZyXwVuTsRqPoNmLkJiHgFeDcBa', folder: 'x', sheet: 'y' });
    expect((await (await POST(req('POST', {}), ctx)).json())).toMatchObject({ mismatch: true, lastTest: { ok: false } });
  });
});
