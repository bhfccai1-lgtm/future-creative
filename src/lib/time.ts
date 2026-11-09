import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';

export const TZ = 'Asia/Bahrain';

export function startOfMonthInTz(now = new Date(), tz = TZ) {
  const ym = formatInTimeZone(now, tz, 'yyyy-MM');
  return fromZonedTime(`${ym}-01T00:00:00`, tz);
}
export function startOfDayInTz(now = new Date(), tz = TZ) {
  return fromZonedTime(`${formatInTimeZone(now, tz, 'yyyy-MM-dd')}T00:00:00`, tz);
}
/** Top of the current hour (UTC instant). Bahrain has no DST so hour boundaries align. */
export function floorToHour(d: Date) { const x = new Date(d); x.setUTCMinutes(0, 0, 0); return x; }

/** Local "HH:mm" of an instant in tz. */
export const localHm = (d: Date, tz = TZ) => formatInTimeZone(d, tz, 'HH:mm');
export const fmtLocal = (d: Date | null | undefined, tz = TZ, f = 'yyyy-MM-dd HH:mm') => (d ? formatInTimeZone(d, tz, f) : '—');

/** Whether local time-of-day of `d` lies within [start, end] window (supports windows crossing midnight). */
export function inWindow(d: Date, start: string, end: string, tz = TZ) {
  const hm = localHm(d, tz);
  return start <= end ? hm >= start && hm <= end : hm >= start || hm <= end;
}

/** Local wall-clock datetime string (no offset) — the format Metricool's publicationDate.dateTime expects. */
export const localDateTime = (d: Date, tz = TZ) => formatInTimeZone(d, tz, "yyyy-MM-dd'T'HH:mm:ss");
export { toZonedTime };
