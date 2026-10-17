import { Info } from "lucide-react";
import { db } from "@/lib/db";
import { formatBDT } from "@/lib/format";
import { listTargetProgress } from "@/lib/collectionTargetsData";
import { parseYearMonth } from "@/lib/collectionTargets";
import { EmptyState, PageHeader, StatCard } from "@/components/ui";
import { ChartCard, Donut } from "@/components/charts";
import { MonthPicker } from "@/components/MonthPicker";
import { WeekFocusSelector } from "@/components/WeekFocusSelector";
import { CollectionTargetManager } from "@/components/CollectionTargetManager";
import { MyTargetCard } from "@/components/MyTargetCard";
import { fstr, type SearchParams } from "@/components/filters";

export const dynamic = "force-dynamic";

/**
 * Admin / Accounts / Credit Control view of the monthly payment-collection
 * targets. The page always answers "for THIS month", navigable with a friendly
 * month/year picker, and the selected month is in the URL so the view is
 * shareable.
 *
 * When `userId` is supplied the view becomes the PERSONAL, read-only page the
 * department apps render: `listTargetProgress` is scoped to that one user and
 * the editable grid is replaced by `MyTargetCard`. The three owner roles omit
 * `userId` and keep the full, editable register.
 *
 * Progress is read from approved payments bucketed by `rcvDate` (see
 * `lib/collectionTargetsData.ts`).
 */
export async function CollectionTargetsView({
  home,
  params,
  userId,
}: {
  home: string;
  params: SearchParams;
  /** Set for a personal (department) view — shows only this user's row, read-only. */
  userId?: string;
}) {
  await db();
  const personal = Boolean(userId);
  const parsed = parseYearMonth(
    fstr(params, "year"),
    fstr(params, "month"),
    fstr(params, "week")
  );
  const { yearMonth: { year, month }, weekIndex } = parsed;
  const data = await listTargetProgress(year, month, weekIndex, userId);

  const now = new Date();
  const current = { year: now.getFullYear(), month: now.getMonth() + 1 };

  const totalTarget = data.totals.target;
  const totalActual = data.totals.actual;
  const remaining = Math.max(totalTarget - totalActual, 0);
  const pct = totalTarget > 0 ? (totalActual / totalTarget) * 100 : 0;
  const achieved = totalTarget > 0 && totalActual >= totalTarget;
  const targeted = data.rows.filter((r) => r.totalTarget > 0);
  const met = targeted.filter((r) => r.totalActual >= r.totalTarget).length;

  // Personal view has exactly one row; the "team" figures become week counts.
  const myRow = data.rows[0] ?? null;
  const weeksWithTarget = myRow ? myRow.target.filter((t) => t > 0).length : 0;
  const weeksMet = myRow
    ? myRow.target.filter((t, i) => t > 0 && myRow.actual[i] >= t).length
    : 0;

  return (
    <div>
      <PageHeader
        title={personal ? "My Collection Targets" : "Collection Targets"}
        subtitle={
          personal
            ? `Your weekly collection target · ${data.label}`
            : `Weekly payment-collection targets ${data.label}`
        }
      />

      <MonthPicker home={home} year={year} month={month} current={current} />

      {/* Week selector - highlights the focused week and refreshes via soft navigation */}
      <WeekFocusSelector
        home={home}
        year={year}
        month={month}
        weekIndex={weekIndex}
      />

      {/* ---- Month at a glance: one progress donut + the four headline figures ---- */}
      <div className="mb-5 grid gap-4 lg:grid-cols-3">
        <ChartCard
          title="Month Progress"
          subtitle={`Approved collection vs target ${data.label}`}
          className="lg:col-span-1"
          footer="Approved payments only, counted by received date and the user who entered them."
        >
          <Donut
            segments={[
              { label: "Collected", value: totalActual, fill: "var(--color-emerald-500)" },
              { label: "Remaining", value: remaining, fill: "var(--color-indigo-500)" },
            ]}
            centerLabel="of target"
            centerValue={`${pct.toFixed(0)}%`}
            emptyMessage="No targets set for this month."
          />
        </ChartCard>

        <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
          <StatCard
            label="Total Target"
            value={formatBDT(totalTarget)}
            accent="purple"
            hint={
              personal
                ? `Your target for ${data.label}`
                : `${targeted.length} user(s) with a target in ${data.label}`
            }
          />
          <StatCard
            label="Total Collected"
            value={formatBDT(totalActual)}
            accent="green"
            hint="Approved payments received this month"
          />
          <StatCard
            label="Remaining"
            value={formatBDT(remaining)}
            accent={achieved ? "green" : "amber"}
            hint={achieved ? "Target fully reached" : "Left to collect this month"}
          />
          {personal ? (
            <StatCard
              label="Weeks On Target"
              value={`${weeksMet} / ${weeksWithTarget}`}
              accent={weeksWithTarget > 0 && weeksMet === weeksWithTarget ? "green" : "indigo"}
              hint="Weeks that reached their target"
            />
          ) : (
            <StatCard
              label="Users On Target"
              value={`${met} / ${targeted.length}`}
              accent={targeted.length > 0 && met === targeted.length ? "green" : "indigo"}
              hint="Reached their monthly target"
            />
          )}
        </div>
      </div>

      <p className="mb-4 flex items-start gap-1.5 text-xs text-theme-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Progress counts approved payments by the user who entered them, using the
          received date (<code>rcvDate</code>). Weeks are fixed: 1-7, 8-14, 15-21,
          22-end.
        </span>
      </p>

      {personal ? (
        myRow ? (
          <MyTargetCard row={myRow} label={data.label} />
        ) : (
          <EmptyState message="No target record found for your account." />
        )
      ) : (
        <CollectionTargetManager rows={data.rows} year={year} month={month} />
      )}
    </div>
  );
}
