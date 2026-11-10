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
 * "Best time" = default local hours ranked by typical Gulf engagement for Instagram/TikTok
 * (lunch break, after-work evening, late evening). This is a general heuristic, not account data:
 * it can later be replaced by Metricool's best-time-to-post per network.
 */
export const BEST_HOURS_RANKED = [20, 13, 21, 18, 12, 22, 10, 16, 9, 15, 19, 11];

const dow = (d: Date) => Number(formatInTimeZone(d, TZ, 'i')) % 7; // ISO 1..7 (Mon..Sun) → 0=Sun
const dayAllowed = (d: Date, days: number[]) => !days.length || days.includes(dow(d));
const localDate = (d: Date) => formatInTimeZone(d, TZ, 'yyyy-MM-dd');
const atLocal = (ymd: string, hour: number) => fromZonedTime(`${ymd}T${String(hour).padStart(2, '0')}:00:00`, TZ);
const addDays = (ymd: string, n: number) => formatInTimeZone(new Date(fromZonedTime(`${ymd}T12:00:00`, TZ).getTime() + n * 86400_000), TZ, 'yyyy-MM-dd');

/** Hours of the day used in BEST mode for a given interval. */
export function bestHoursFor(everyHours: number): number[] {
  if (everyHours >= 24) return [BEST_HOURS_RANKED[0]];
  const perDay = Math.max(1, Math.min(BEST_HOURS_RANKED.length, Math.floor(24 / Math.max(1, everyHours))));
  return BEST_HOURS_RANKED.slice(0, perDay).sort((a, b) => a - b);
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
