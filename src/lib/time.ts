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
