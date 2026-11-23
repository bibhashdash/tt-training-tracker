// Date helpers. All dates are ISO "YYYY-MM-DD" strings with no time zone;
// "today" is resolved in the rider's time zone (Europe/London by default).
// Pure functions: callers pass `now` so these stay testable.

export type IsoDate = string;
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7; // ISO: Mon = 1

const DAY_MS = 86_400_000;
const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function toUtc(date: IsoDate): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Not an ISO date: ${date}`);
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The calendar date in `timeZone` at instant `now`. */
export function todayIn(timeZone: string, now: Date): IsoDate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Wall-clock "HH:MM" in `timeZone` at instant `now`. */
export function timeIn(timeZone: string, now: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
}

export function isoWeekday(date: IsoDate): Weekday {
  const sundayZero = new Date(toUtc(date)).getUTCDay();
  return (((sundayZero + 6) % 7) + 1) as Weekday;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromUtc(toUtc(date) + days * DAY_MS);
}

/** The Monday on or before `date`. */
export function weekStart(date: IsoDate): IsoDate {
  return addDays(date, 1 - isoWeekday(date));
}

/** The date of `weekday` in the week starting `monday`. */
export function dateOfWeekday(monday: IsoDate, weekday: Weekday): IsoDate {
  return addDays(monday, weekday - 1);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

/** 1-based calendar week of the block. Can be 0 or negative before the block starts. */
export function calendarWeek(blockStart: IsoDate, date: IsoDate): number {
  return Math.floor(daysBetween(blockStart, date) / 7) + 1;
}

export function weekdayShort(weekday: Weekday): string {
  return WEEKDAY_SHORT[weekday - 1];
}

/** "Mon 23 Nov" */
export function formatShort(date: IsoDate): string {
  const d = new Date(toUtc(date));
  return `${weekdayShort(isoWeekday(date))} ${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]}`;
}

/** "07:00:00" (Postgres time) -> "07:00" */
export function hhmm(time: string | null | undefined): string {
  return time ? time.slice(0, 5) : "";
}
