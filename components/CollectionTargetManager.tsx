"use client";

import { useActionState, useMemo, useState } from "react";
import { Search, Target, Users, X } from "lucide-react";
import { saveCollectionTargets } from "@/app/actions/collectionTargets";
import { ErrorBanner, SuccessBanner } from "@/components/form";
import { SearchSelect, type SearchOption } from "@/components/SearchSelect";
import { StackedBar } from "@/components/charts";
import { useTheme } from "@/components/ThemeProvider";
import { formatBDT } from "@/lib/format";
import { WEEK_LABELS, progressPct } from "@/lib/collectionTargets";
import type { CollectionTargetRow } from "@/lib/collectionTargetsData";
import type { ActionResult } from "@/lib/types";

/**
 * The editable month grid. One form covers every user, so a single Save button
 * commits the whole month. Inputs are named `week-<userId>-<weekIndex>` and the
 * server action regroups them.
 *
 * The "Find user" box is a real form control look-alike: a type-to-search
 * dropdown (`SearchSelect`, used as a pure picker - it submits nothing) that
 * narrows the grid to a single person's card. The two are independent - the
 * filter only hides other cards from view, and the action only ever writes the
 * users whose inputs are on screen, so filtering can never blank out a teammate.
 */
export function CollectionTargetManager({
  rows,
  year,
  month,
}: {
  rows: CollectionTargetRow[];
  year: number;
  month: number;
}) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [state, formAction, pending] = useActionState<ActionResult | undefined, FormData>(
    saveCollectionTargets,
    undefined
  );
  const [filterUserId, setFilterUserId] = useState("");

  // Theme-aware Tailwind, NOT `.input-field`: SearchSelect appends `pr-9` for its
  // clear/chevron buttons and unlayered `.input-field` padding would beat it.
  const input =
    "w-full rounded-lg border px-3.5 py-2.5 text-sm transition-all focus:outline-none focus:ring-2 " +
    (isDark
      ? "border-zinc-600 bg-zinc-800 text-zinc-100 placeholder-zinc-500 focus:border-indigo-400 focus:bg-zinc-700 focus:ring-indigo-500/30"
      : "border-zinc-300 bg-zinc-50 text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:bg-white focus:ring-indigo-500/20");

  const options = useMemo<SearchOption[]>(
    () => rows.map((r) => ({ value: r.userId, label: r.name, hint: r.roleLabel })),
    [rows]
  );

  const visibleRows = useMemo(
    () => (filterUserId ? rows.filter((r) => r.userId === filterUserId) : rows),
    [rows, filterUserId]
  );

  const filteredUser = filterUserId
    ? rows.find((r) => r.userId === filterUserId) ?? null
    : null;

  return (
    <form action={formAction} className="grid gap-4">
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="month" value={month} />

      <SuccessBanner message={state?.ok ? "Targets saved." : undefined} />
      <ErrorBanner message={state && !state.ok ? state.error : undefined} />

      {/* ---- Find a user: narrows the grid to one card ---- */}
      <div className="surface-card flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-64 flex-1">
          <label className="mb-1 block text-xs font-medium text-theme-muted">
            Find user
          </label>
          <SearchSelect
            options={options}
            value={filterUserId}
            onValueChange={setFilterUserId}
            placeholder="Search by name."
            emptyMessage="No user matches"
            className={input}
          />
        </div>
        <p className="flex items-center gap-1.5 pb-2.5 text-xs text-theme-muted">
          <Users className="h-3.5 w-3.5" />
          {filteredUser
            ? `Showing ${filteredUser.name} · ${rows.length} user(s) total`
            : `${rows.length} user(s)`}
        </p>
        {filterUserId ? (
          <button
            type="button"
            onClick={() => setFilterUserId("")}
            className="btn-ghost mb-0.5 h-11!"
          >
            <X className="h-3.5 w-3.5" />
            Show all
          </button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="surface-card p-8 text-center text-sm text-theme-muted">
          No active users to target.
        </p>
      ) : (
        <div
          className={`grid gap-4 ${
            filterUserId ? "max-w-2xl sm:grid-cols-1" : "sm:grid-cols-2 xl:grid-cols-3"
          }`}
        >
          {visibleRows.map((row) => (
            <UserTargetCard key={row.userId} row={row} />
          ))}
        </div>
      )}

      {/* Sticky save bar so the button is reachable on a long user list. */}
      <div className="sticky bottom-4 z-10 flex items-center justify-end gap-3">
        {filteredUser ? (
          <span className="flex items-center gap-1.5 rounded-lg border border-theme bg-theme-surface px-3 py-2 text-xs text-theme-muted shadow-lg">
            <Search className="h-3.5 w-3.5" />
            Saving {filteredUser.name}&apos;s targets only
          </span>
        ) : null}
        <button type="submit" disabled={pending} className="btn-primary shadow-lg">
          <Target className="mr-1 inline h-3.5 w-3.5" />
          {pending ? "Saving." : "Save Targets"}
        </button>
      </div>
    </form>
  );
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function barColor(pct: number): string {
  if (pct >= 100) return "var(--color-emerald-500)";
  if (pct >= 50) return "var(--color-indigo-500)";
  return "var(--color-amber-400)";
}

function UserTargetCard({ row }: { row: CollectionTargetRow }) {
  const pct = progressPct(row.totalActual, row.totalTarget);
  const remaining = Math.max(row.totalTarget - row.totalActual, 0);
  const hasTarget = row.totalTarget > 0;
  const achieved = hasTarget && row.totalActual >= row.totalTarget;

  return (
    <div className="surface-card flex flex-col gap-4 p-4">
      {/* Identity + overall achievement */}
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-600 to-purple-600 text-[11px] font-bold text-white">
          {initials(row.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-theme-strong">{row.name}</p>
          <span className="pill pill-indigo mt-0.5 inline-block">{row.roleLabel}</span>
        </div>
        <div className="shrink-0 text-right">
          <p
            className={`text-lg font-bold ${
              achieved ? "text-emerald-400" : hasTarget ? "text-amber-300" : "text-theme-muted"
            }`}
          >
            {hasTarget ? `${pct.toFixed(0)}%` : "-"}
          </p>
          <p className="text-[10px] uppercase tracking-wider text-theme-muted">of target</p>
        </div>
      </div>

      {/* Bar chart: collected vs remaining for this user */}
      <StackedBar
        segments={[
          { label: "Collected", value: row.totalActual, fill: "var(--color-emerald-500)" },
          { label: "Remaining", value: remaining, fill: "var(--color-indigo-500)" },
        ]}
        emptyMessage="No target set."
        showLegend={false}
      />

      {/* Headline figures */}
      <div className="grid grid-cols-3 gap-2 rounded-lg border border-theme bg-theme-surface p-2 text-center">
        <MiniStat label="Target" value={formatBDT(row.totalTarget)} />
        <MiniStat label="Collected" value={formatBDT(row.totalActual)} tone="green" />
        <MiniStat label="Remaining" value={formatBDT(remaining)} tone="amber" />
      </div>

      {/* Weekly inputs */}
      <div className="grid grid-cols-2 gap-2">
        {WEEK_LABELS.map((label, i) => (
          <WeekCell
            key={label}
            label={label}
            userId={row.userId}
            index={i}
            target={row.target[i]}
            actual={row.actual[i]}
          />
        ))}
      </div>
    </div>
  );
}

function WeekCell({
  label,
  userId,
  index,
  target,
  actual,
}: {
  label: string;
  userId: string;
  index: number;
  target: number;
  actual: number;
}) {
  const wpct = progressPct(actual, target);
  return (
    <label className="flex flex-col gap-1.5 rounded-lg border border-theme p-2 transition-colors focus-within:border-indigo-500/60">
      <span className="text-[11px] font-medium text-theme-muted">{label}</span>
      <input
        type="number"
        name={`week-${userId}-${index}`}
        defaultValue={target ? String(target) : ""}
        min="0"
        step="1"
        placeholder="0"
        inputMode="numeric"
        className="input-field w-full"
      />
      <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${Math.min(wpct, 100)}%`,
            backgroundColor: target > 0 ? barColor(wpct) : "transparent",
          }}
        />
      </div>
      <span className="text-[10px] text-theme-muted">
        {formatBDT(actual)} / {target > 0 ? formatBDT(target) : "-"}
      </span>
    </label>
  );
}

function MiniStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "green" | "amber";
}) {
  const color =
    tone === "green"
      ? "text-emerald-400"
      : tone === "amber"
        ? "text-amber-300"
        : "text-theme-strong";
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wider text-theme-muted">{label}</p>
      <p className={`mt-0.5 truncate text-sm font-semibold ${color}`} title={value}>
        {value}
      </p>
    </div>
  );
}