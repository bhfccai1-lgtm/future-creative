import Link from 'next/link';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/server';
import { PageHeader } from '@/components/ui';
import { TZ } from '@/lib/time';
import type { AdState } from '@prisma/client';

const DOT: Record<AdState, string> = { PUBLISHED: 'bg-emerald-500', SCHEDULED: 'bg-navy-700', QUEUED: 'bg-sky-500', PUBLISHING: 'bg-sky-500', FAILED: 'bg-red-500', UNKNOWN: 'bg-amber-500', REJECTED: 'bg-slate-400', DRAFT: 'bg-slate-300', GENERATING: 'bg-slate-300', GENERATED: 'bg-slate-300', QUALITY_REVIEW: 'bg-amber-300', APPROVED: 'bg-gold-500' };
const DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  await requirePageUser();
  const m = (await searchParams).m ?? formatInTimeZone(new Date(), TZ, 'yyyy-MM');
  const [y, mo] = m.split('-').map(Number);
  const start = fromZonedTime(`${m}-01T00:00:00`, TZ);
  const nextM = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  const prevM = mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
  const end = fromZonedTime(`${nextM}-01T00:00:00`, TZ);
  const jobs = await prisma.publicationJob.findMany({ where: { scheduledFor: { gte: start, lt: end } }, include: { account: true, advertisement: true }, orderBy: { scheduledFor: 'asc' } });
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const firstDow = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay();
  const byDay = new Map<number, typeof jobs>();
  for (const j of jobs) { const d = Number(formatInTimeZone(j.scheduledFor, TZ, 'd')); byDay.set(d, [...(byDay.get(d) ?? []), j]); }
  return (
    <>
      <PageHeader title="التقويم" subtitle={`منشورات شهر ${m} — حسب توقيت البحرين`} actions={<><Link className="rounded border px-3 py-1 text-sm" href={`?m=${prevM}`}>‹ السابق</Link><Link className="rounded border px-3 py-1 text-sm" href={`?m=${nextM}`}>التالي ›</Link></>} />
      <div className="grid grid-cols-7 gap-1 text-xs">
        {DAYS.map((d) => <div key={d} className="p-2 text-center font-bold text-slate-500">{d}</div>)}
        {Array.from({ length: firstDow }).map((_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => (
          <div key={d} className="min-h-28 rounded-lg border bg-white p-1.5">
            <div className="mb-1 font-bold text-slate-600">{d}</div>
            {(byDay.get(d) ?? []).slice(0, 6).map((j) => (
              <Link key={j.id} href={`/ads/${j.advertisementId}`} className="mb-0.5 flex items-center gap-1 truncate rounded px-1 hover:bg-slate-100">
                <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[j.state]}`} /><span className="ltr">{formatInTimeZone(j.scheduledFor, TZ, 'HH:mm')}</span><span className="truncate">{j.account.name}</span>
              </Link>
            ))}
            {(byDay.get(d)?.length ?? 0) > 6 && <div className="text-slate-400">+{byDay.get(d)!.length - 6}</div>}
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-4 text-xs">{(['PUBLISHED', 'SCHEDULED', 'QUEUED', 'UNKNOWN', 'FAILED'] as AdState[]).map((s) => <span key={s} className="flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${DOT[s]}`} />{s}</span>)}</div>
    </>
  );
}
