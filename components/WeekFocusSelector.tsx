"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { WEEK_LABELS } from "@/lib/collectionTargets";

/**
 * Week focus selector for the Collection Targets page.
 *
 * Keeps the chosen week in local state so the blue highlight appears instantly,
 * then does a soft client-side navigation (`router.push`) — no full page
 * refresh. The server prop `weekIndex` stays the source of truth on load and is
 * re-synced (browser Back/Forward, month changes), so the highlight always
 * matches the URL.
 *
 * NOTE: `.btn-ghost` (globals.css) is unlayered and would otherwise win over
 * Tailwind utilities, so the selected colours use the trailing-`!` important
 * modifier to actually render.
 */
export function WeekFocusSelector({
  home,
  year,
  month,
  weekIndex,
}: {
  home: string;
  year: number;
  month: number;
  weekIndex: number | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<number | null>(weekIndex);
  const [prevProp, setPrevProp] = useState<number | null>(weekIndex);

  // Re-sync when the server prop changes (Back/Forward, month change) — the
  // documented "adjust state during render" pattern, so no effect is needed.
  if (weekIndex !== prevProp) {
    setPrevProp(weekIndex);
    setSelected(weekIndex);
  }

  const go = (i: number | null) => {
    setSelected(i);
    startTransition(() => {
      router.push(
        i == null
          ? `${home}/targets?year=${year}&month=${month}`
          : `${home}/targets?year=${year}&month=${month}&week=${i + 1}`
      );
    });
  };

  const base =
    "btn-ghost focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/20";
  const active = "bg-blue-600! text-white! hover:bg-blue-700!";
  const idle = "border-theme text-theme-muted hover:bg-sky-100";

  return (
    <div className="surface-card mb-3 p-3">
      <p className="text-xs text-theme-muted uppercase mb-2">Week focus</p>
      <div className="flex gap-2">
        {WEEK_LABELS.map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => go(i)}
            disabled={pending}
            className={`${base} ${i === selected ? active : idle}`}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => go(null)}
          disabled={pending}
          className={`${base} ${selected === null ? active : idle}`}
        >
          Month view
        </button>
      </div>
    </div>
  );
}
