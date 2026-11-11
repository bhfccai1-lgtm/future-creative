/** Engagement rate (%) — same formula as manual entry: (likes + 2·comments + 3·saves + 3·shares) / reach. */
export interface Metrics { reach?: number; views?: number; likes?: number; comments?: number; saves?: number; shares?: number; watchTimeSec?: number; profileVisits?: number }
export function engagementRate(m: Metrics): number | null {
  const base = m.reach && m.reach > 0 ? m.reach : m.views && m.views > 0 ? m.views : 0;
  if (!base) return null; // no reach/views → no score (never invented)
  const inter = (m.likes ?? 0) + 2 * (m.comments ?? 0) + 3 * (m.saves ?? 0) + 3 * (m.shares ?? 0);
  return (inter / base) * 100;
}
