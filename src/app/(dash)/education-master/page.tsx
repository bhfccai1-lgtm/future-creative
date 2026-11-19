import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/server';
import { getSettings } from '@/lib/settings';
import { getAiProvider } from '@/lib/ai';
import { EduStudio } from '@/components/edu-studio';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'EDUCATION MASTER AI V4.0' };

/** EDUCATION MASTER AI V4.0 — educational print production (separate from the advertising system). */
export default async function EducationMasterPage() {
  const user = await requirePageUser('ads:create');
  const [rows, s] = await Promise.all([
    prisma.eduProject.findMany({ where: user.perms.includes('users:manage') ? {} : { createdBy: user.email }, orderBy: { updatedAt: 'desc' }, take: 100, select: { id: true, title: true, type: true, updatedAt: true, source: true, qc: true } }),
    getSettings(),
  ]);
  const aiLive = !(await getAiProvider(s).then((p) => p.isDryRun).catch(() => true));
  return <EduStudio initialProjects={JSON.parse(JSON.stringify(rows))} aiLive={aiLive} curriculum={s.education} canAdmin={user.perms.includes('settings:ai')} />;
}
