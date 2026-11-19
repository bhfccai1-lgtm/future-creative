import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { getSettings, updateSettings } from '@/lib/settings';
import { audit } from '@/lib/audit';
import { curriculumToText, parseCurriculumText } from '@/lib/edu/choices';
/** download the saved lists as an editable text file */
export const GET = api('ads:create', async () => {
  const s = await getSettings();
  return new Response(curriculumToText(s.education.curriculum, s.education.curriculumYear), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="curriculum-${s.education.curriculumYear}.txt"` } });
});
/** bulk import: preview (dry) or save — each subject+grade in the text replaces the saved list of that subject+grade */
export const POST = api('settings:ai', async (req, { user }) => {
  const b = z.object({ text: z.string().max(400_000), save: z.boolean().default(false), curriculumYear: z.string().trim().max(20).optional() }).parse(await req.json());
  const { entries, errors } = parseCurriculumText(b.text);
  if (!b.save) return NextResponse.json({ ok: true, preview: entries.map((e) => ({ subject: e.subject, grade: e.grade, lessons: e.lessons.length })), errors });
  const s = await updateSettings((cur) => {
    const keep = cur.education.curriculum.filter((e) => !entries.some((n) => n.subject === e.subject && n.grade === e.grade));
    return { ...cur, education: { curriculumYear: b.curriculumYear || cur.education.curriculumYear, curriculum: [...keep, ...entries].slice(0, 200) } };
  }, user.email);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'edu.curriculum.import', details: { lists: entries.length, lessons: entries.reduce((a, e) => a + e.lessons.length, 0), errors: errors.length } });
  return NextResponse.json({ ok: true, ...s.education, imported: entries.length, errors });
});
