﻿﻿"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { MONTH_LABELS } from "@/lib/collectionTargets";

/**
 * A friendly month/year selector for the Collection Targets page.
 *
 * Turns the old "type a 4-digit year, pick a month, press Go" form into plain
 * dropdowns that navigate on change, wrapped in prev/next arrows and a
 * "This month" reset. The month and year live in the URL, so the choice is
 * shareable and a browser Back still works.
 *
 * `current` is passed in from the server rather than read here, so the server
 * and client render the same "today" and never trip a hydration mismatch.
 */
export function MonthPicker({
  home,
  year,
  month,
  current,
}: {
  home: string;
  year: number;
  month: number;
  current: { year: number; month: number };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const go = (y: number, m: number) => {
    startTransition(() => router.push(`${home}/targets?year=${y}&month=${m}`));
  };

  const shift = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1);
    go(d.getFullYear(), d.getMonth() + 1);
  };

  const isCurrent = year === current.year && month === current.month;

  // Keep the year list centred on the selection, always including this year.
  const years = Array.from(
    new Set([
      current.year,
      ...[year - 2, year - 1, year, year + 1, year + 2],
    ])
  ).sort((a, b) => a - b);

  const btn = "btn-ghost flex h-11! w-11! items-center justify-center p-0!";
  const select = `input-field w-auto! ${pending ? "opacity-60" : ""}`;

  return (
    <div className="surface-card mb-5 flex flex-wrap items-center gap-2 p-3">
      <span className="mr-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-theme-muted">
        <CalendarDays className="h-4 w-4" />
        Month
      </span>

      <button
        type="button"
        className={btn}
        onClick={() => shift(-1)}
        disabled={pending}
        title="Previous month"
        aria-label="Previous month"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      <select
        aria-label="Month"
        className={select}
        value={month}
        disabled={pending}
        onChange={(e) => go(year, Number(e.target.value))}
      >
        {MONTH_LABELS.map((label, i) => (
          <option key={label} value={i + 1}>
            {label}
          </option>
        ))}
      </select>

      <select
        aria-label="Year"
        className={select}
        value={year}
        disabled={pending}
        onChange={(e) => go(Number(e.target.value), month)}
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>

      <button
        type="button"
        className={btn}
        onClick={() => shift(1)}
        disabled={pending}
        title="Next month"
        aria-label="Next month"
      >
        <ChevronRight className="h-4 w-4" />
      </button>

      {!isCurrent ? (
        <button
          type="button"
          className="btn-ghost ml-1 h-11!"
          onClick={() => go(current.year, current.month)}
          disabled={pending}
          title="Jump to the current month"
        >
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          This month
        </button>
      ) : null}

      {pending ? (
        <span className="ml-auto text-xs text-theme-muted">Loading…</span>
      ) : null}
    </div>
  );
}



