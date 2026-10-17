import { StackedBar } from "@/components/charts";
import { formatBDT } from "@/lib/format";
import { WEEK_LABELS, progressPct } from "@/lib/collectionTargets";
import type { CollectionTargetRow } from "@/lib/collectionTargetsData";

/**
 * Read-only personal target card for the department apps.
 *
 * Deliberately server-rendered and form-free: a department user may READ their
 * own target but never sets it (that stays with admin/accounts/creditcontrol,
 * enforced by `saveCollectionTargets`). This mirrors `UserTargetCard` in
 * `CollectionTargetManager` but replaces the week inputs with plain figures.
 */
export function MyTargetCard({ row, label }: { row: CollectionTargetRow; label: string }) {
  const pct = progressPct(row.totalActual, row.totalTarget);
  const remaining = Math.max(row.totalTarget - row.totalActual, 0);
  const hasTarget = row.totalTarget > 0;
  const achieved = hasTarget && row.totalActual >= row.totalTarget;

  return (
    <div className="surface-card flex flex-col gap-5 p-5">
      {/* Identity + overall achievement */}
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-600 to-purple-600 text-xs font-bold text-white">
          {initials(row.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-theme-strong">{row.name}</p>
          <p className="text-xs text-theme-muted">Your collection target · {label}</p>
        </div>
        <div className="shrink-0 text-right">
          <p
            className={`text-2xl font-bold ${
              achieved ? "text-emerald-400" : hasTarget ? "text-amber-300" : "text-theme-muted"
            }`}
          >
            {hasTarget ? `${pct.toFixed(0)}%` : "-"}
          </p>
          <p className="text-[10px] uppercase tracking-wider text-theme-muted">of target</p>
        </div>
      </div>

      {/* Collected vs remaining for the month */}
      <StackedBar
        segments={[
          { label: "Collected", value: row.totalActual, fill: "var(--color-emerald-500)" },
          { label: "Remaining", value: remaining, fill: "var(--color-indigo-500)" },
        ]}
        emptyMessage="No target set for this month."
        showLegend={false}
      />

      {/* Headline figures */}
      <div className="grid grid-cols-3 gap-2 rounded-lg border border-theme bg-theme-surface p-3 text-center">
        <MiniStat label="Target" value={formatBDT(row.totalTarget)} />
        <MiniStat label="Collected" value={formatBDT(row.totalActual)} tone="green" />
        <MiniStat label="Remaining" value={formatBDT(remaining)} tone="amber" />
      </div>

      {/* Weekly breakdown */}
      <div className="grid gap-2 sm:grid-cols-2">
        {WEEK_LABELS.map((weekLabel, i) => (
          <WeekRow
            key={weekLabel}
            label={weekLabel}
            target={row.target[i]}
            actual={row.actual[i]}
          />
        ))}
      </div>
    </div>
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

function WeekRow({ label, target, actual }: { label: string; target: number; actual: number }) {
  const pct = progressPct(actual, target);
  return (
    <div className="rounded-lg border border-theme p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium text-theme-muted">{label}</span>
        <span className="shrink-0 text-xs font-semibold text-theme-strong">
          {target > 0 ? `${pct.toFixed(0)}%` : "-"}
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${Math.min(pct, 100)}%`,
            backgroundColor: target > 0 ? barColor(pct) : "transparent",
          }}
        />
      </div>
      <p className="mt-1.5 text-[10px] text-theme-muted">
        {formatBDT(actual)} / {target > 0 ? formatBDT(target) : "-"}
      </p>
    </div>
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
