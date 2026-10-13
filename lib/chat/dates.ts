export type DateRange = {
  /** Inclusive start (local day start) */
  from: Date;
  /** Inclusive end (local day end) */
  to: Date;
  /** Human label for replies */
  label: string;
};

const MONTHS: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function daysAgo(n: number, now = new Date()): Date {
  const d = new Date(now);
  d.setDate(d.getDate() - n);
  return startOfDay(d);
}

function formatRange(from: Date, to: Date): string {
  const sameDay =
    from.getFullYear() === to.getFullYear() &&
    from.getMonth() === to.getMonth() &&
    from.getDate() === to.getDate();
  if (sameDay) {
    return from.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }
  const f = from.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const t = to.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  return `${f} – ${t}`;
}

function makeRange(from: Date, to: Date, label?: string): DateRange {
  return {
    from: startOfDay(from),
    to: endOfDay(to),
    label: label ?? formatRange(from, to),
  };
}

function parseMonthName(token: string): number | null {
  const t = token.toLowerCase().replace(/\./g, "");
  return MONTHS[t] ?? null;
}

/** Week starting Monday */
function startOfWeek(now = new Date()): Date {
  const d = startOfDay(now);
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return d;
}

function startOfMonth(now = new Date(), offset = 0): Date {
  const d = startOfDay(now);
  d.setMonth(d.getMonth() + offset, 1);
  return d;
}

function endOfMonth(now = new Date(), offset = 0): Date {
  const d = startOfDay(now);
  d.setMonth(d.getMonth() + offset + 1, 0);
  return endOfDay(d);
}

function parseOneDate(token: string, now: Date, opts?: { lockYear?: number; noPastFallback?: boolean }): Date | null {
  const t = token.toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;

  const yearInText = t.match(/\b(20\d{2})\b/);
  const year = opts?.lockYear ?? (yearInText ? Number(yearInText[1]) : now.getFullYear());

  const iso = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const slashFull = t.match(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})\b/);
  if (slashFull) {
    let y = Number(slashFull[3]);
    if (y < 100) y += 2000;
    const d = new Date(y, Number(slashFull[2]) - 1, Number(slashFull[1]));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // day/month without year: 1/9, 30.09
  const slashNoYear = t.match(/^\s*(\d{1,2})[/.](\d{1,2})\s*$/);
  if (slashNoYear) {
    const dayNum = Number(slashNoYear[1]);
    const month = Number(slashNoYear[2]) - 1;
    if (month < 0 || month > 11) return null;
    const d = new Date(year, month, dayNum);
    if (d.getDate() !== dayNum) return null;
    if (!opts?.noPastFallback && !opts?.lockYear && !yearInText && d.getTime() > now.getTime()) {
      d.setFullYear(year - 1);
    }
    return d;
  }

  const dayMonth = t.match(/\b(\d{1,2})\s+([a-z]+)\b/);
  if (dayMonth) {
    const month = parseMonthName(dayMonth[2]);
    if (month !== null) {
      const dayNum = Number(dayMonth[1]);
      const d = new Date(year, month, dayNum);
      if (!Number.isNaN(d.getTime()) && d.getDate() === dayNum) {
        if (!opts?.noPastFallback && !opts?.lockYear && !yearInText && d.getTime() > now.getTime()) {
          d.setFullYear(year - 1);
        }
        return d;
      }
    }
  }

  const monthDay = t.match(/\b([a-z]+)\s+(\d{1,2})\b/);
  if (monthDay) {
    const month = parseMonthName(monthDay[1]);
    if (month !== null) {
      const dayNum = Number(monthDay[2]);
      const d = new Date(year, month, dayNum);
      if (!Number.isNaN(d.getTime()) && d.getDate() === dayNum) {
        if (!opts?.noPastFallback && !opts?.lockYear && !yearInText && d.getTime() > now.getTime()) {
          d.setFullYear(year - 1);
        }
        return d;
      }
    }
  }

  const monthOnly = t.match(/\b([a-z]{3,9})\b/);
  if (monthOnly) {
    const month = parseMonthName(monthOnly[1]);
    if (month !== null) {
      let y = year;
      if (!opts?.lockYear && !yearInText && month < now.getMonth()) y = now.getFullYear();
      return new Date(y, month, 1);
    }
  }

  return null;
}

/**
 * Extract one date or date range from free text.
 * Supports absolute dates, "1 sep to 30 sep", and common relative phrases.
 */
export function parseDateRange(text: string, now = new Date()): DateRange | null {
  const raw = text.toLowerCase();
  const normalized = raw.replace(/,/g, " ").replace(/\s+/g, " ").trim();

  // Explicit range: "1 sep to 30 sep", "from 1/9 until 30/9", "2026-09-01 – 2026-09-30"
  const explicit = normalized.match(
    /^(?:from\s+)?(.+?)\s+(?:to|through|thru|till|until|–|—|-)\s+(.+)$/
  );
  if (explicit) {
    const left = explicit[1].trim();
    const right = explicit[2].trim();
    const yearInText =
      left.match(/\b(20\d{2})\b/)?.[1] ??
      right.match(/\b(20\d{2})\b/)?.[1] ??
      null;
    const lockYear = yearInText ? Number(yearInText) : now.getFullYear();

    // Same calendar year for both ends when no explicit year (avoids "1 sep to 30 sep" → 2025–2026)
    const a = parseOneDate(left, now, { lockYear, noPastFallback: true });
    const b = parseOneDate(right, now, { lockYear, noPastFallback: true });
    if (a && b) {
      const from = a.getTime() <= b.getTime() ? a : b;
      const to = a.getTime() <= b.getTime() ? b : a;
      const aDay = /\d{1,2}/.test(left);
      const bDay = /\d{1,2}/.test(right);
      if (!aDay && !bDay) {
        const end = new Date(to.getFullYear(), to.getMonth() + 1, 0);
        return makeRange(from, end);
      }
      return makeRange(from, to);
    }
  }

  // Relative day words first
  if (/\b(today|tmr|tomorrow)\b/.test(normalized)) {
    if (/\btomorrow\b|\btmr\b/.test(normalized)) {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      return makeRange(d, d);
    }
    return makeRange(now, now, formatRange(now, now));
  }
  if (/\byesterday\b/.test(normalized)) {
    const d = daysAgo(1, now);
    return makeRange(d, d);
  }
  if (/\blast week\b|\bprevious week\b/.test(normalized)) {
    const end = daysAgo(1, now);
    const start = startOfWeek(now);
    start.setDate(start.getDate() - 7);
    return makeRange(start, end, "last week");
  }
  if (/\bthis week\b|\bcurrent week\b/.test(normalized)) {
    return makeRange(startOfWeek(now), now, "this week");
  }
  if (/\blast month\b|\bprevious month\b/.test(normalized)) {
    return makeRange(startOfMonth(now, -1), endOfMonth(now, -1), "last month");
  }
  if (/\bthis month\b|\bcurrent month\b/.test(normalized)) {
    return makeRange(startOfMonth(now), now, "this month");
  }
  if (/\bytd\b|\bthis year\b|\bcurrent year\b/.test(normalized)) {
    const start = new Date(now.getFullYear(), 0, 1);
    return makeRange(start, now, `YTD (${now.getFullYear()})`);
  }
  if (/\blast year\b/.test(normalized)) {
    const y = now.getFullYear() - 1;
    return makeRange(new Date(y, 0, 1), new Date(y, 11, 31, 23, 59, 59, 999), `${y}`);
  }
  const lastNDays = normalized.match(/\blast (\d{1,3}) days?\b/);
  if (lastNDays) {
    const n = Number(lastNDays[1]);
    return makeRange(daysAgo(n - 1, now), now, `last ${n} days`);
  }

  // ISO date: 2026-07-19
  const iso = normalized.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    if (!Number.isNaN(d.getTime())) return makeRange(d, d);
  }

  // Slash/dot: 19/07/2026 or 19.07.26 (day first)
  const slash = normalized.match(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})\b/);
  if (slash) {
    let year = Number(slash[3]);
    if (year < 100) year += 2000;
    const d = new Date(year, Number(slash[2]) - 1, Number(slash[1]));
    if (!Number.isNaN(d.getTime())) return makeRange(d, d);
  }

  // "19 july" / "19 july 2026"
  const dayMonth = normalized.match(/\b(\d{1,2})\s+([a-z]+)\b/);
  if (dayMonth) {
    const month = parseMonthName(dayMonth[2]);
    if (month !== null) {
      const dayNum = Number(dayMonth[1]);
      let year = now.getFullYear();
      const yearInText = normalized.match(/\b(20\d{2})\b/);
      if (yearInText) year = Number(yearInText[1]);
      const d = new Date(year, month, dayNum);
      if (!Number.isNaN(d.getTime()) && d.getDate() === dayNum) {
        // If absolute day is in the future and no year given, try last year
        if (!yearInText && d.getTime() > now.getTime()) {
          d.setFullYear(year - 1);
        }
        return makeRange(d, d);
      }
    }
  }

  // "july 19" / "july 19 2026"
  const monthDay = normalized.match(/\b([a-z]+)\s+(\d{1,2})\b/);
  if (monthDay) {
    const month = parseMonthName(monthDay[1]);
    if (month !== null) {
      const dayNum = Number(monthDay[2]);
      let year = now.getFullYear();
      const yearInText = normalized.match(/\b(20\d{2})\b/);
      if (yearInText) year = Number(yearInText[1]);
      const d = new Date(year, month, dayNum);
      if (!Number.isNaN(d.getTime()) && d.getDate() === dayNum) {
        if (!yearInText && d.getTime() > now.getTime()) d.setFullYear(year - 1);
        return makeRange(d, d);
      }
    }
  }

  // Month name anywhere: "sales in august", "in july", "august"
  const monthWords = normalized.match(/\b([a-z]{3,9})\b/g) ?? [];
  for (const word of monthWords) {
    const month = parseMonthName(word);
    if (month === null) continue;
    const yearInText = normalized.match(/\b(20\d{2})\b/);
    let year = yearInText ? Number(yearInText[1]) : now.getFullYear();
    if (!yearInText && month < now.getMonth()) year = now.getFullYear();
    const from = new Date(year, month, 1);
    const to = new Date(year, month + 1, 0);
    return makeRange(from, to, `${word} ${year}`);
  }

  return null;
}
