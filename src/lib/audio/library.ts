import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prisma } from '../db';
import { storage } from '../storage';
import { run } from '../video/probe';
import { AppError } from '../errors';

export const MOODS = [
  { value: 'upbeat', ar: 'حماسي' },
  { value: 'calm', ar: 'هادئ' },
  { value: 'luxury', ar: 'فاخر' },
  { value: 'festive', ar: 'احتفالي' },
  { value: 'corporate', ar: 'رسمي للشركات' },
] as const;
/** Design style → preferred music mood. */
export const MOOD_FOR_STYLE: Record<string, string> = { luxury_navy_gold: 'luxury', black_gold: 'luxury', white_minimal: 'calm', emerald_gold: 'luxury', festive: 'festive', vibrant: 'upbeat' };

const MAX_BYTES = 20 * 1024 * 1024;
const TYPES: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav' };

/** Duration via ffprobe; also proves the file really is decodable audio. */
export async function probeAudio(buf: Buffer, ext: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fc-aud-'));
  try {
    const f = path.join(dir, `in.${ext}`);
    await fs.writeFile(f, buf);
    const r = await run(process.env.FFPROBE_PATH ?? 'ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', f], 60_000);
    const j = r.code === 0 ? JSON.parse(r.stdout) : {};
    const a = j.streams?.find((s: { codec_type: string }) => s.codec_type === 'audio');
    if (!a) throw new AppError('VALIDATION', 'الملف ليس ملف صوت صالحًا.', 422);
    return { durationSec: Number(j.format?.duration ?? a.duration ?? 0) };
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

export async function addTrack(file: { name: string; type: string; buf: Buffer }, o: { name?: string; mood: string; licenseNote: string; startSec?: number; bpm?: number | null; actor: string }) {
  const ext = TYPES[file.type] ?? (/\.(mp3|m4a|aac|wav)$/i.exec(file.name)?.[1]?.toLowerCase());
  if (!ext) throw new AppError('VALIDATION', 'الصيغ المقبولة: MP3 أو M4A أو AAC أو WAV.', 415);
  if (file.buf.length > MAX_BYTES) throw new AppError('VALIDATION', 'الملف أكبر من 20MB.', 413);
  if (o.licenseNote.trim().length < 3) throw new AppError('VALIDATION', 'اذكر مصدر الترخيص (مثل: Pixabay، YouTube Audio Library، مشتراة من …).', 422);
  const { durationSec } = await probeAudio(file.buf, ext);
  if (durationSec < 6) throw new AppError('VALIDATION', 'المقطع أقصر من 6 ثوانٍ.', 422);
  const key = `audio/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  await storage().put(key, file.buf, file.type || `audio/${ext}`);
  return prisma.audioTrack.create({ data: {
    name: (o.name || file.name.replace(/\.[^.]+$/, '')).slice(0, 100), mood: MOODS.some((m) => m.value === o.mood) ? o.mood : 'upbeat',
    storageKey: key, mimeType: file.type || `audio/${ext}`, durationSec, startSec: Math.max(0, Math.min(o.startSec ?? 0, Math.max(0, durationSec - 6))),
    bpm: o.bpm ?? null, licenseNote: o.licenseNote.trim().slice(0, 300), createdBy: o.actor,
  } });
}

/** Least-recently-used active track, preferring the mood; null when the library is empty. */
export async function pickTrack(mood?: string) {
  const order = [{ lastUsedAt: { sort: 'asc' as const, nulls: 'first' as const } }, { createdAt: 'asc' as const }];
  const t = (mood && await prisma.audioTrack.findFirst({ where: { active: true, mood }, orderBy: order })) || await prisma.audioTrack.findFirst({ where: { active: true }, orderBy: order });
  if (!t) return null;
  await prisma.audioTrack.update({ where: { id: t.id }, data: { uses: { increment: 1 }, lastUsedAt: new Date() } });
  return { ...t, buf: await storage().get(t.storageKey), ext: t.storageKey.split('.').pop()! };
}
