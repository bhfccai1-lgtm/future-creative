import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { setSecret } from '@/lib/settings';
import { generateAdvertisement } from '@/lib/pipeline/generate';
import { queueGoogleArchive, appsScriptSource } from '@/lib/integrations/google-archive';
import { deliverPending } from '@/lib/integrations/events';
import { captureQueues, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });
describe('direct Google Drive archive (Apps Script)', () => {
  it('not configured → nothing queued; configured → outbox row with signed links to the exact files, delivered to the script', async () => {
    const { accounts } = await seedBase();
    const r = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'IMAGE_FEED' });
    expect(await queueGoogleArchive(r.advertisement.id, null)).toBeNull();
    const url = 'https://script.google.com/macros/s/AKfycbTESTTESTTESTTESTTEST/exec';
    await setSecret('GOOGLE_ARCHIVE_URL', url, 't');
    const d = (await queueGoogleArchive(r.advertisement.id, 'https://www.instagram.com/p/x'))!;
    expect(d.target).toBe(url);
    const p = d.payload as { event: string; data: { files: { url: string; name: string }[]; adId: string; publicUrl: string } };
    expect(p.event).toBe('archive.google');
    expect(p.data.files).toHaveLength(1);
    expect(p.data.files[0].url).toMatch(/\/api\/m\/\d+\/[\w-]+\/ads\/.+final\.jpg$/);
    let seen = '';
    const res = await deliverPending((async (u: string, init: { body: string }) => { seen = `${u} ${JSON.parse(init.body).data.adId}`; return new Response('{"ok":true}', { status: 200 }); }) as unknown as typeof fetch);
    expect(res.delivered).toBe(1);
    expect(seen).toBe(`${url} ${r.advertisement.id}`);
  });
  it('the generated script only downloads from the system host and skips duplicates', () => {
    const src = appsScriptSource({ folderId: 'F1', sheetId: 'S1', host: 'example.test' });
    expect(src).toContain("const ALLOWED_HOST = 'example.test'");
    expect(src).toMatch(/duplicate: true/);
    expect(src).toMatch(/getSheetByName\('published'\)/);
  });
});
