import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { getSettings, updateSettings } from '@/lib/settings';
import { audit } from '@/lib/audit';
import { SUBJECTS } from '@/lib/edu/choices';
/** the official lesson list for the current year (entered from the textbook contents) */
export const GET = api('ads:create', async () => NextResponse.json({ ok: true, ...(await getSettings()).education }));
/** saves the list of ONE subject + grade (empty lessons removes it) */
export const PUT = api('settings:ai', async (req, { user }) => {
  const b = z.object({ subject: z.enum(SUBJECTS.map((s) => s.ar) as [string, ...string[]]), grade: z.number().int().min(0).max(12), lessons: z.array(z.string().trim().min(1).max(160)).max(80), source: z.string().trim().max(200).optional(), curriculumYear: z.string().trim().max(20).optional() }).parse(await req.json());
  const s = await updateSettings((cur) => {
    const rest = cur.education.curriculum.filter((e) => !(e.subject === b.subject && e.grade === b.grade));
    return { ...cur, education: { curriculumYear: b.curriculumYear || cur.education.curriculumYear, curriculum: b.lessons.length ? [...rest, { subject: b.subject, grade: b.grade, lessons: [...new Set(b.lessons)], source: b.source }] : rest } };
  }, user.email);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'edu.curriculum', details: { subject: b.subject, grade: b.grade, lessons: b.lessons.length } });
  return NextResponse.json({ ok: true, ...s.education });
});
