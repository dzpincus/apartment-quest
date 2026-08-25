import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

export const NY_TZ = "America/New_York";

/** Today in New York as `yyyy-MM-dd` (what the follow-up buckets compare against). */
export function todayNY(now: Date = new Date()): string {
  return format(new TZDate(now, NY_TZ), "yyyy-MM-dd");
}

/** Render a UTC timestamp in New York time. */
export function fmtNY(date: Date | string | number, pattern = "MMM d, h:mma"): string {
  const d = typeof date === "string" || typeof date === "number" ? new Date(date) : date;
  return format(new TZDate(d, NY_TZ), pattern);
}

/** New York wall-clock date object, for day arithmetic. */
export function nowNY(now: Date = new Date()): TZDate {
  return new TZDate(now, NY_TZ);
}

/**
 * Render a date-only column (`yyyy-MM-dd`, e.g. `next_action_due`) without
 * timezone drift — parsing it as an instant would land on the previous day in
 * New York.
 */
export function fmtDay(day: string, pattern = "MMM d"): string {
  return format(new TZDate(`${day}T12:00:00`, NY_TZ), pattern);
}

/**
 * Calendar arithmetic on a `yyyy-MM-dd` day. Done in UTC on purpose: no
 * instant is involved, so a DST change cannot shift the result.
 */
export function addDays(day: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!m) return day;
  const d = new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days),
  );
  return d.toISOString().slice(0, 10);
}

/** The default due date for a forced next action. */
export function tomorrowNY(now: Date = new Date()): string {
  return addDays(todayNY(now), 1);
}
