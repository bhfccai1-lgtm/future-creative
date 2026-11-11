import { beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prisma } from '@/lib/db';
import { addTrack, pickTrack } from '@/lib/audio/library';
import { generateAdvertisement } from '@/lib/pipeline/generate';
import { run } from '@/lib/video/probe';
import { captureQueues, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });
const mp3 = async (sec: number) => {
  const f = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'fc-m-')), 'm.mp3');
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=f=330:d=${sec}`, '-c:a', 'libmp3lame', f]);
  return fs.readFile(f);
};

describe('licensed music library', () => {
  it('requires a licence note, rejects non-audio and too-short clips', async () => {
    await seedBase();
    await expect(addTrack({ name: 'a.mp3', type: 'audio/mpeg', buf: await mp3(10) }, { mood: 'upbeat', licenseNote: '', actor: 't' })).rejects.toThrow(/الترخيص/);
    await expect(addTrack({ name: 'a.mp3', type: 'audio/mpeg', buf: Buffer.from('not audio') }, { mood: 'upbeat', licenseNote: 'Pixabay', actor: 't' })).rejects.toThrow(/صوت/);
    await expect(addTrack({ name: 'a.mp3', type: 'audio/mpeg', buf: await mp3(3) }, { mood: 'upbeat', licenseNote: 'Pixabay', actor: 't' })).rejects.toThrow(/أقصر/);
  });
  it('rotates least-recently-used tracks, preferring the mood', async () => {
    await seedBase();
    const a = await addTrack({ name: 'A.mp3', type: 'audio/mpeg', buf: await mp3(10) }, { mood: 'luxury', licenseNote: 'Pixabay', actor: 't' });
    const b = await addTrack({ name: 'B.mp3', type: 'audio/mpeg', buf: await mp3(10) }, { mood: 'luxury', licenseNote: 'Pixabay', actor: 't' });
    await addTrack({ name: 'C.mp3', type: 'audio/mpeg', buf: await mp3(10) }, { mood: 'upbeat', licenseNote: 'Pixabay', actor: 't' });
    const picks = [(await pickTrack('luxury'))!.id, (await pickTrack('luxury'))!.id, (await pickTrack('luxury'))!.id];
    expect(picks).toEqual([a.id, b.id, a.id]);
    expect((await pickTrack('festive'))!.name).toBe('C'); // no festive track → least used overall
  });
  it('a voice-over reel uses the library track and records what was used (licence trail)', async () => {
    const { accounts } = await seedBase();
    const t = await addTrack({ name: 'Bed.mp3', type: 'audio/mpeg', buf: await mp3(20) }, { mood: 'upbeat', licenseNote: 'YouTube Audio Library', actor: 't' });
    const r = await generateAdvertisement({ accountId: accounts[0].id, createdBy: 't', format: 'REEL_VIDEO', direction: { audio: 'voiceover' } });
    const o = (await prisma.advertisement.findUniqueOrThrow({ where: { id: r.advertisement.id } })).options as { audio: string; audioUsed: { trackId: string; license: string; voiceOver: boolean; sfx: boolean; voiceScript: string } };
    expect(o.audio).toBe('voiceover');
    expect(o.audioUsed).toMatchObject({ trackId: t.id, license: 'YouTube Audio Library', voiceOver: true, sfx: true });
    expect(o.audioUsed.voiceScript).not.toMatch(/[0-9]/);
    expect(o.audioUsed).toMatchObject({ voiceLang: 'ar_bh' });
    expect((o.audioUsed as unknown as { persona: string }).persona).toBeTruthy();
    expect((await prisma.audioTrack.findUniqueOrThrow({ where: { id: t.id } })).uses).toBe(1);
  }, 300_000);
});
