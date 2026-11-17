import { CONTENT_TYPES } from './options';

/**
 * Content planner: automatic seasonal occasion + content-angle rotation, used whenever the operator
 * leaves these choices on "automatic". Makes timely content without manual planning and keeps every
 * account from repeating the same angle.
 *
 * Lunar dates (Ramadan / Eids) are astronomical estimates; the real day can shift ±1–2 days with moon
 * sighting, which is fine for a lead window. Extend LUNAR when the years run out.
 */
type Window = { key: string; from: Date; to: Date; peak: Date; weight: number; langs?: string[]; market?: 'BH' | 'KSA' };
const d = (s: string) => new Date(`${s}T00:00:00+03:00`);
const addDays = (x: Date, n: number) => new Date(x.getTime() + n * 86400_000);

const LUNAR: Record<number, { ramadan: string; fitr: string; adha: string; hijriNewYear: string; mawlid: string; diwali?: string; onam?: string }> = {
  2026: { ramadan: '2026-02-18', fitr: '2026-03-20', adha: '2026-05-27', hijriNewYear: '2026-06-16', mawlid: '2026-08-25', diwali: '2026-11-08', onam: '2026-08-26' },
  2027: { ramadan: '2027-02-08', fitr: '2027-03-10', adha: '2027-05-16', hijriNewYear: '2027-06-06', mawlid: '2027-08-14', diwali: '2027-10-29', onam: '2027-09-12' },
  2028: { ramadan: '2028-01-28', fitr: '2028-02-26', adha: '2028-05-05', hijriNewYear: '2028-05-25', mawlid: '2028-08-03', diwali: '2028-10-17', onam: '2028-08-31' },
  2029: { ramadan: '2029-01-16', fitr: '2029-02-14', adha: '2029-04-24', hijriNewYear: '2029-05-14', mawlid: '2029-07-24', diwali: '2029-11-05', onam: '2029-08-20' },
};
/** n-th weekday of a month (weekday 0 = Sunday), e.g. third Sunday of June = nthWeekday(y, 6, 0, 3). */
export function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
/** a short lead window ending the day after the peak */
const around = (key: string, peak: Date, lead: number, weight: number, extra: Partial<Window> = {}): Window => ({ key, from: addDays(peak, -lead), to: addDays(peak, 1), peak, weight, ...extra });

export function seasonalWindows(year: number): Window[] {
  const w: Window[] = [
    { key: 'bahrain_national_day', from: d(`${year}-12-01`), to: d(`${year}-12-17`), peak: d(`${year}-12-16`), weight: 0.6, market: 'BH' },
    { key: 'bahraini_women_day', from: d(`${year}-11-20`), to: d(`${year}-12-02`), peak: d(`${year}-12-01`), weight: 0.45, market: 'BH' },
    { key: 'teachers_day', from: d(`${year}-09-25`), to: d(`${year}-10-06`), peak: d(`${year}-10-05`), weight: 0.4 },
    { key: 'new_year', from: d(`${year}-12-20`), to: d(`${year + 1}-01-03`), peak: d(`${year + 1}-01-01`), weight: 0.35 },
    { key: 'mothers_day', from: d(`${year}-03-07`), to: d(`${year}-03-22`), peak: d(`${year}-03-21`), weight: 0.5, langs: ['ar', 'en'] },
    { key: 'graduation', from: d(`${year}-05-15`), to: d(`${year}-07-15`), peak: d(`${year}-06-20`), weight: 0.4 },
    { key: 'back_to_school', from: d(`${year}-08-15`), to: d(`${year}-09-12`), peak: d(`${year}-09-01`), weight: 0.45 },
    { key: 'saudi_national_day', from: d(`${year}-09-10`), to: d(`${year}-09-24`), peak: d(`${year}-09-23`), weight: 0.6, market: 'KSA' },
    { key: 'wedding_season', from: d(`${year}-10-15`), to: d(`${year + 1}-04-30`), peak: d(`${year}-12-31`), weight: 0.15 },
    // Gulf (other countries' national days: low weight — mostly campaigns for clients with Gulf ties)
    around('saudi_founding_day', d(`${year}-02-22`), 12, 0.5, { market: 'KSA' }),
    around('kuwait_national_day', d(`${year}-02-25`), 10, 0.12),
    around('oman_national_day', d(`${year}-11-20`), 10, 0.12),
    around('uae_national_day', d(`${year}-12-02`), 10, 0.12),
    around('qatar_national_day', d(`${year}-12-18`), 10, 0.12),
    // international (gifting / print-relevant days)
    around('valentines', d(`${year}-02-14`), 12, 0.3, { langs: ['ar', 'en'] }),
    around('employee_appreciation', d(nthWeekday(year, 3, 5, 1)), 12, 0.35),
    around('womens_day', d(`${year}-03-08`), 8, 0.3),
    around('world_book_day', d(`${year}-04-23`), 8, 0.3),
    around('labour_day', d(`${year}-05-01`), 8, 0.25),
    around('nurses_day', d(`${year}-05-12`), 8, 0.3),
    around('fathers_day', d(nthWeekday(year, 6, 0, 3)), 12, 0.4),
    around('friendship_day', d(`${year}-07-30`), 8, 0.25),
    around('photography_day', d(`${year}-08-19`), 8, 0.35),
    around('coffee_day', d(`${year}-10-01`), 8, 0.4),
    around('boss_day', d(`${year}-10-16`), 8, 0.3),
    around('world_childrens_day', d(`${year}-11-20`), 8, 0.3),
    around('arabic_language_day', d(`${year}-12-18`), 10, 0.35, { langs: ['ar'] }),
    // communities in Bahrain
    around('vishu', d(`${year}-04-14`), 10, 0.5, { langs: ['ml'] }),
    around('india_independence', d(`${year}-08-15`), 8, 0.45, { langs: ['ml', 'en'] }),
    around('india_republic', d(`${year}-01-26`), 8, 0.4, { langs: ['ml', 'en'] }),
    around('christmas', d(`${year}-12-25`), 14, 0.35, { langs: ['en', 'ml'] }),
  ];
  const l = LUNAR[year];
  if (l) {
    const r = d(l.ramadan), f = d(l.fitr), a = d(l.adha);
    w.push({ key: 'ramadan', from: addDays(r, -14), to: addDays(f, -4), peak: r, weight: 0.55 });
    w.push({ key: 'gergaoon', from: addDays(r, 4), to: addDays(r, 15), peak: addDays(r, 14), weight: 0.6, market: 'BH' });
    w.push({ key: 'eid_fitr', from: addDays(f, -10), to: addDays(f, 3), peak: f, weight: 0.65 });
    w.push({ key: 'eid_adha', from: addDays(a, -14), to: addDays(a, 3), peak: a, weight: 0.6 });
    w.push(around('hijri_new_year', d(l.hijriNewYear), 6, 0.35, { langs: ['ar'] }));
    w.push(around('mawlid', d(l.mawlid), 6, 0.3, { langs: ['ar'] }));
    if (l.diwali) w.push({ key: 'diwali', from: addDays(d(l.diwali), -14), to: addDays(d(l.diwali), 1), peak: d(l.diwali), weight: 0.6, langs: ['ml', 'en'] });
    if (l.onam) w.push({ key: 'onam', from: addDays(d(l.onam), -10), to: addDays(d(l.onam), 1), peak: d(l.onam), weight: 0.6, langs: ['ml'] });
  }
  return w;
}

export const marketOf = (a: { name: string; handle?: string | null; businessCategory?: string | null }): 'BH' | 'KSA' =>
  /ksa|saudi|سعود/i.test(`${a.name} ${a.handle ?? ''} ${a.businessCategory ?? ''}`) ? 'KSA' : 'BH';

/** Active seasonal windows for a date, best first (closest to peak, then weight). */
export function activeOccasions(now: Date, ctx: { language: string; market: 'BH' | 'KSA'; disabled?: string[] }) {
  const y = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Bahrain', year: 'numeric' }).format(now));
  return [...seasonalWindows(y - 1), ...seasonalWindows(y)]
    .filter((w) => now >= w.from && now <= w.to && !ctx.disabled?.includes(w.key) && (!w.langs || w.langs.includes(ctx.language)) && (!w.market || w.market === ctx.market))
    .map((w) => ({ ...w, daysToPeak: Math.round((w.peak.getTime() - now.getTime()) / 86400_000) }))
    .sort((a, b) => Math.abs(a.daysToPeak) - Math.abs(b.daysToPeak) || b.weight - a.weight);
}

/**
 * Picks an occasion for an automatic design, or null for an everyday post. The share of seasonal posts rises
 * near the peak (last 3 days → 80%) so feeds stay varied instead of 100% seasonal for weeks.
 */
export function pickOccasion(now: Date, ctx: { language: string; market: 'BH' | 'KSA'; disabled?: string[] }, rng: () => number = Math.random): string | null {
  // ONE draw: the chance of a seasonal post is the strongest active occasion's chance (overlapping occasions do not add up),
  // then one of the active occasions is chosen in proportion to its own chance
  const all = activeOccasions(now, ctx).map((w) => ({ key: w.key, near: w.daysToPeak >= 0 && w.daysToPeak <= 3, p: w.daysToPeak >= 0 && w.daysToPeak <= 3 ? 0.8 : w.weight }));
  if (!all.length) return null;
  // an occasion in its last 3 days before the peak takes priority over the others that merely overlap
  const act = all.some((a) => a.near) ? all.filter((a) => a.near) : all;
  const pMax = Math.max(...act.map((a) => a.p));
  const r = rng();
  if (r >= pMax) return null;
  const total = act.reduce((x, a) => x + a.p, 0);
  let t = (r / pMax) * total; // reuse the draw: uniform over [0, total)
  for (const a of act) { if (t < a.p) return a.key; t -= a.p; }
  return act[act.length - 1].key;
}

/** Rotates content angles: never one of the last 3 used on this account. */
export function pickContentType(recent: (string | null | undefined)[], rng: () => number = Math.random): string {
  const blocked = new Set(recent.filter(Boolean).slice(0, 3));
  const pool = CONTENT_TYPES.filter((c) => !blocked.has(c.value));
  const list = pool.length ? pool : CONTENT_TYPES;
  return list[Math.floor(rng() * list.length)].value;
}

/** Category suggestions per occasion (Arabic names; only existing categories are used). */
export const OCCASION_CATEGORIES: Record<string, string[]> = {
  bahrain_national_day: ['هدايا الموظفين والعملاء', 'الحملات والمبادرات', 'واجهات المحلات', 'البنرات والطباعة الكبيرة', 'الهدايا الشخصية'],
  saudi_national_day: ['هدايا الموظفين والعملاء', 'الحملات والمبادرات', 'واجهات المحلات', 'البنرات والطباعة الكبيرة'],
  bahraini_women_day: ['هدايا الموظفين والعملاء', 'الهدايا الشخصية', 'المطبوعات الفاخرة'],
  new_year: ['الطباعة المكتبية', 'مطبوعات الشركات', 'هدايا الموظفين والعملاء'],
  ramadan: ['المطاعم والمقاهي', 'المشاريع المنزلية', 'واجهات المحلات', 'الهدايا الشخصية'],
  gergaoon: ['الأطفال والمدارس', 'المشاريع المنزلية', 'الهدايا الشخصية'],
  eid_fitr: ['الهدايا الشخصية', 'المشاريع المنزلية', 'هدايا الموظفين والعملاء', 'المطبوعات الفاخرة'],
  eid_adha: ['الهدايا الشخصية', 'المشاريع المنزلية', 'هدايا الموظفين والعملاء'],
  mothers_day: ['الهدايا الشخصية', 'طباعة الأكواب', 'المطبوعات الفاخرة'],
  graduation: ['الأطفال والمدارس', 'الهدايا الشخصية', 'المعارض والمؤتمرات'],
  back_to_school: ['الأطفال والمدارس', 'المطبوعات التعليمية'],
  teachers_day: ['الأطفال والمدارس', 'الهدايا الشخصية', 'طباعة الأكواب'],
  wedding_season: ['الأعراس والحفلات', 'المطبوعات الفاخرة', 'المناسبات والأعراس'],
  diwali: ['الهدايا الشخصية', 'المشاريع المنزلية'],
  onam: ['الهدايا الشخصية', 'المشاريع المنزلية'],
  hijri_new_year: ['الطباعة المكتبية', 'مطبوعات الشركات', 'المطبوعات الفاخرة'],
  mawlid: ['المطبوعات الفاخرة', 'الهدايا الشخصية', 'واجهات المحلات'],
  saudi_founding_day: ['هدايا الموظفين والعملاء', 'الحملات والمبادرات', 'واجهات المحلات', 'البنرات والطباعة الكبيرة'],
  kuwait_national_day: ['هدايا الموظفين والعملاء', 'الهدايا الشخصية', 'الحملات والمبادرات'],
  oman_national_day: ['هدايا الموظفين والعملاء', 'الهدايا الشخصية', 'الحملات والمبادرات'],
  uae_national_day: ['هدايا الموظفين والعملاء', 'الهدايا الشخصية', 'الحملات والمبادرات'],
  qatar_national_day: ['هدايا الموظفين والعملاء', 'الهدايا الشخصية', 'الحملات والمبادرات'],
  valentines: ['الهدايا الشخصية', 'طباعة الأكواب', 'المطبوعات الفاخرة'],
  employee_appreciation: ['هدايا الموظفين والعملاء', 'طباعة الأكواب', 'مطبوعات الشركات'],
  womens_day: ['الهدايا الشخصية', 'هدايا الموظفين والعملاء', 'المطبوعات الفاخرة'],
  world_book_day: ['المطبوعات التعليمية', 'الطباعة المكتبية', 'الأطفال والمدارس'],
  labour_day: ['هدايا الموظفين والعملاء', 'مطبوعات الشركات'],
  nurses_day: ['هدايا الموظفين والعملاء', 'طباعة الأكواب', 'الصالونات والعيادات'],
  fathers_day: ['الهدايا الشخصية', 'طباعة الأكواب', 'المطبوعات الفاخرة'],
  friendship_day: ['الهدايا الشخصية', 'طباعة الأكواب'],
  photography_day: ['الهدايا الشخصية', 'المطبوعات الفاخرة', 'طباعة الأكواب'],
  coffee_day: ['طباعة الأكواب', 'المطاعم والمقاهي', 'التغليف والعرض'],
  boss_day: ['هدايا الموظفين والعملاء', 'المطبوعات الفاخرة'],
  world_childrens_day: ['الأطفال والمدارس', 'الهدايا الشخصية'],
  arabic_language_day: ['المطبوعات الفاخرة', 'المطبوعات التعليمية', 'الأطفال والمدارس'],
  vishu: ['الهدايا الشخصية', 'المشاريع المنزلية'],
  india_independence: ['الحملات والمبادرات', 'الهدايا الشخصية'],
  india_republic: ['الحملات والمبادرات', 'الهدايا الشخصية'],
  christmas: ['الهدايا الشخصية', 'هدايا الموظفين والعملاء', 'المطبوعات الفاخرة'],
};

/** Occasions whose window starts or runs within the next `days` days (nearest peak first). */
export function upcomingOccasions(now: Date, days = 120) {
  const y = Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Bahrain', year: 'numeric' }).format(now));
  const horizon = now.getTime() + days * 86400_000;
  const seen = new Set<string>();
  return [...seasonalWindows(y - 1), ...seasonalWindows(y), ...seasonalWindows(y + 1)]
    .filter((w) => w.to.getTime() >= now.getTime() && w.from.getTime() <= horizon)
    .sort((a, b) => a.peak.getTime() - b.peak.getTime())
    .filter((w) => { const k = `${w.key}:${w.peak.toISOString()}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .map((w) => ({ ...w, daysToPeak: Math.round((w.peak.getTime() - now.getTime()) / 86400_000), startAt: new Date(Math.max(now.getTime(), w.from.getTime())), endAt: addDays(w.peak, 1) }));
}
