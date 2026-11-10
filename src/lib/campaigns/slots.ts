import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { TZ } from '../time';

/**
 * Pure slot calculator for campaigns (shared by server + UI preview).
 * All wall-clock maths happens in Asia/Bahrain (UTC+3, no DST).
 */
export interface SlotRule {
  scheduleType: 'ONCE' | 'RECURRING';
  everyHours: number;
  daysOfWeek: number[]; // 0=Sun … 6=Sat, empty = all days
  timeMode: 'BEST' | 'FIXED';
  startAt: Date;
  endAt?: Date | null;
  maxRuns?: number | null;
  runs?: number;
}

/**
 * "Best time" ranking from REAL Metricool best-time-to-post data for the brand's Instagram audience
 * (bhfcc.mugs, Asia/Bahrain, Nov 2026): peak 10:00, then 11–12, then the 18:00 evening peak.
 * Late evening (21–23) is among the weakest hours for this audience.
 */
export const BEST_HOURS_RANKED = [10, 11, 12, 18, 9, 17, 16, 15, 13, 14, 19, 8];

const dow = (d: Date) => Number(formatInTimeZone(d, TZ, 'i')) % 7; // ISO 1..7 (Mon..Sun) → 0=Sun
const dayAllowed = (d: Date, days: number[]) => !days.length || days.includes(dow(d));
const localDate = (d: Date) => formatInTimeZone(d, TZ, 'yyyy-MM-dd');
const atLocal = (ymd: string, hour: number) => fromZonedTime(`${ymd}T${String(hour).padStart(2, '0')}:00:00`, TZ);
const addDays = (ymd: string, n: number) => formatInTimeZone(new Date(fromZonedTime(`${ymd}T12:00:00`, TZ).getTime() + n * 86400_000), TZ, 'yyyy-MM-dd');

/** Hours of the day used in BEST mode for a given interval. */
export function bestHoursFor(everyHours: number): number[] {
  if (everyHours >= 24) return [BEST_HOURS_RANKED[0]];
  const perDay = Math.max(1, Math.min(BEST_HOURS_RANKED.length, Math.floor(24 / Math.max(1, everyHours))));
  // pick the best-ranked hours while keeping them spread out (no 10:00, 11:00, 12:00 clusters)
  const gap = Math.max(2, Math.floor((24 / perDay) * 0.5));
  const picked: number[] = [];
  for (const h of BEST_HOURS_RANKED) if (picked.length < perDay && picked.every((p) => Math.abs(p - h) >= gap)) picked.push(h);
  for (const h of BEST_HOURS_RANKED) if (picked.length < perDay && !picked.includes(h)) picked.push(h);
  return picked.sort((a, b) => a - b);
}

/** Next slot strictly after `after`, or null if the campaign is finished. */
export function nextSlot(rule: SlotRule, after: Date): Date | null {
  if (rule.maxRuns && (rule.runs ?? 0) >= rule.maxRuns) return null;
  const ok = (d: Date) => d.getTime() > after.getTime() && d.getTime() >= rule.startAt.getTime() && (!rule.endAt || d.getTime() <= rule.endAt.getTime());
  if (rule.scheduleType === 'ONCE') return (rule.runs ?? 0) === 0 && rule.startAt.getTime() > after.getTime() ? rule.startAt : null;

  const H = Math.max(1, Math.round(rule.everyHours));
  if (rule.timeMode === 'FIXED') {
    // startAt + k·H hours, skipping days that are not selected
    const step = H * 3600_000;
    let k = Math.max(0, Math.ceil((Math.max(after.getTime() + 1, rule.startAt.getTime()) - rule.startAt.getTime()) / step));
    for (let i = 0; i < 5000; i++, k++) {
      const d = new Date(rule.startAt.getTime() + k * step);
      if (rule.endAt && d.getTime() > rule.endAt.getTime()) return null;
      if (ok(d) && dayAllowed(d, rule.daysOfWeek)) return d;
    }
    return null;
  }

  // BEST: daily best hours (or one best hour every N days for intervals ≥ 24h)
  const hours = bestHoursFor(H);
  const dayStep = H >= 24 ? Math.max(1, Math.round(H / 24)) : 1;
  const startYmd = localDate(rule.startAt);
  const fromYmd = localDate(new Date(Math.max(after.getTime(), rule.startAt.getTime())));
  // align to the day-step grid that starts at startAt's local date
  let ymd = startYmd;
  while (ymd < fromYmd) ymd = addDays(ymd, dayStep);
  for (let i = 0; i < 1000; i++, ymd = addDays(ymd, dayStep)) {
    const probe = atLocal(ymd, 12);
    if (rule.endAt && atLocal(ymd, 0).getTime() > rule.endAt.getTime()) return null;
    if (!dayAllowed(probe, rule.daysOfWeek)) continue;
    for (const h of hours) { const d = atLocal(ymd, h); if (ok(d)) return d; }
  }
  return null;
}

/** Preview of the next n slots (UI). */
export function previewSlots(rule: SlotRule, from: Date, n = 5): Date[] {
  const out: Date[] = [];
  let cursor = new Date(from.getTime() - 1);
  let runs = rule.runs ?? 0;
  for (let i = 0; i < n; i++) {
    const s = nextSlot({ ...rule, runs }, cursor);
    if (!s) break;
    out.push(s); cursor = s; runs++;
  }
  return out;
}
