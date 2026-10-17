/**
 * Pure, DB-free helpers for the Payment Collection Targets feature.
 *
 * Keeping the calendar maths here (and out of the data/action layers) means the
 * week bucketing can be reasoned about and tested on its own. `weekIndexForDate()`
 * is the single authority on which week a stored date lands in, and the UI labels
 * are pinned to the same day split (`WEEK_LABELS`), so the two cannot disagree.
 *
 * All windows are computed on the LOCAL calendar, exactly like
 * `lib/dashboard.ts` does for its period ranges — the stored date is an instant,
 * so it must be compared against local month/week boundaries.
 */

/** A month is always split into exactly four weeks for targeting purposes. */
export const WEEKS_IN_MONTH = 4;

/** Human labels for the four buckets, matching `weekIndexForDate()`'s day split. */
export const WEEK_LABELS = [
  "Week 1 (1–7)",
  "Week 2 (8–14)",
  "Week 3 (15–21)",
  "Week 4 (22–end)",
] as const;

export const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export type YearMonth = { year: number; month: number };

/** Inclusive local start / exclusive local end for a calendar month. */
export function monthRange(year: number, month: number): { start: Date; endExclusive: Date } {
  return {
    start: new Date(year, month - 1, 1),
    endExclusive: new Date(year, month, 1),
  };
}

/** Which of the four fixed weeks a local date falls in (0–3). */
export function weekIndexForDate(date: Date): number {
  const day = date.getDate();
  if (day <= 7) return 0;
  if (day <= 14) return 1;
  if (day <= 21) return 2;
  return 3;
}

/**
 * Parses a `week` search param (1–4) from a URL. Returns the 0-based index, or
 * `null` when the param is absent/invalid — `null` means "no week focus", i.e.
 * show the full month, which is deliberately distinct from week 1 (index 0).
 */
export function parseWeek(rawWeek: string | undefined): number | null {
  const w = Number(rawWeek);
  return Number.isInteger(w) && w >= 1 && w <= 4 ? w - 1 : null;
}

/**
 * Sum a list of dated payments into the month's four week buckets.
 *
 * The caller is responsible for having already restricted the list to the month
 * and to approved payments; this only places each row by its `date`.
 */
export function bucketByWeek(
  payments: readonly { rcvAmount: number; date: Date | string }[]
): number[] {
  const sums = [0, 0, 0, 0];
  for (const p of payments) {
    const d = p.date instanceof Date ? p.date : new Date(p.date);
    if (Number.isNaN(d.getTime())) continue;
    const idx = weekIndexForDate(d);
    sums[idx] += Number(p.rcvAmount) || 0;
  }
  return sums;
}

/** Coerce arbitrary input into a length-4 array of finite, non-negative numbers. */
export function normalizeWeeks(input: unknown): number[] {
  const arr = Array.isArray(input) ? input : [];
  return Array.from({ length: WEEKS_IN_MONTH }, (_, i) => {
    const n = Number(arr[i]);
    return Number.isFinite(n) && n > 0 ? n : 0;
  });
}

export function sumWeeks(weeks: readonly number[]): number {
  return normalizeWeeks(weeks).reduce((s, n) => s + n, 0);
}

/** Achieved percentage of target; 0 when no target is set. */
export function progressPct(actual: number, target: number): number {
  if (!target || target <= 0) return 0;
  return (actual / target) * 100;
}

/** `{ year, month }` for a month a number of steps away from the given one. */
export function addMonths(year: number, month: number, delta: number): YearMonth {
  const d = new Date(year, month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export function monthLabel(year: number, month: number): string {
  return `${MONTH_LABELS[month - 1] ?? month} ${year}`;
}

/**
 * Parse `?year=&month=` search params, falling back to `now` for anything
 * missing or out of range so the page always has a real, navigable month.
 */
export function parseYearMonth(
  rawYear: string | undefined,
  rawMonth: string | undefined,
  rawWeek: string | undefined,
  now: Date = new Date()
): { yearMonth: YearMonth; weekIndex: number | null } {
  const y = Number(rawYear);
  const m = Number(rawMonth);
  const weekIdx = parseWeek(rawWeek);
  return {
    yearMonth: {
      year: Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : now.getFullYear(),
      month: Number.isInteger(m) && m >= 1 && m <= 12 ? m : now.getMonth() + 1,
    },
    weekIndex: weekIdx,
  };
}







