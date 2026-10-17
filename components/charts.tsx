/**
 * Chart primitives for the Admin / Accounts overview.
 *
 * Hand-rolled on purpose: no charting dependency is installed, and these are
 * server-rendered, so there is no "use client" and no client bundle cost.
 *
 * Two rules run through every component here:
 *
 * 1. **Theme via CSS variables, not hex.** SVG has no `currentColor` fallback for
 *    `fill`/`stroke` in a useful way here, so strokes and fills are
 *    `var(--theme-*)` arbitrary values. That is what makes the charts legible in
 *    light mode without a second set of props — the `html.light` variable swap
 *    in `globals.css` does all the work.
 * 2. **Every chart says what it is not.** The two registers answer different
 *    questions, so a caption naming the register is part of the component, not
 *    something the caller has to remember.
 */

import { formatBDT, formatNumber } from "@/lib/format";

/** Severity → bar colour, used by the aging chart and the promise pills. */
export const SEVERITY_FILL = [
  "var(--color-emerald-500)",
  "var(--color-amber-400)",
  "var(--color-orange-500)",
  "var(--color-rose-500)",
] as const;

export const SEVERITY_TEXT = [
  "text-emerald-400",
  "text-amber-400",
  "text-orange-400",
  "text-rose-400",
] as const;

/* ------------------------------------------------------------------ */
/* Section shell                                                        */
/* ------------------------------------------------------------------ */

/**
 * A titled card for one chart. `footer` carries the register/derivation note —
 * the place where "this is the manual col G, not a due-date calculation" lives.
 */
export function ChartCard({
  title,
  subtitle,
  action,
  children,
  footer,
  className = "",
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`surface-card flex flex-col p-5 ${className}`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-theme-strong">
            {title}
          </h2>
          {subtitle ? <p className="mt-0.5 text-xs text-theme-muted">{subtitle}</p> : null}
        </div>
        {action ? <div className="shrink-0 text-xs">{action}</div> : null}
      </div>
      <div className="flex-1">{children}</div>
      {footer ? <p className="mt-4 text-xs text-theme-muted">{footer}</p> : null}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Stacked proportion bar                                               */
/* ------------------------------------------------------------------ */

export type StackSegment = {
  label: string;
  value: number;
  /** CSS colour. Defaults to a shared palette by index. */
  fill?: string;
};

const STACK_PALETTE = [
  "var(--color-indigo-500)",
  "var(--color-emerald-500)",
  "var(--color-amber-400)",
  "var(--color-sky-500)",
  "var(--color-fuchsia-500)",
  "var(--color-rose-500)",
] as const;

/**
 * One horizontal 100%-wide bar split into segments, with a legend beneath.
 *
 * Used for the bill-routing split. The segments are "bills visible in this app",
 * NOT a partition of the money — a bill can route to more than one department —
 * so the caller must pass the exclusive count alongside it. The legend shows
 * counts as well as amounts for exactly that reason.
 */
export function StackedBar({
  segments,
  formatValue = formatBDT,
  emptyMessage = "Nothing to split yet.",
  showLegend = true,
}: {
  segments: StackSegment[];
  formatValue?: (value: number) => string;
  emptyMessage?: string;
  /** Hide the legend when the caller already lists the figures. */
  showLegend?: boolean;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (!total) return <p className="py-8 text-center text-xs text-theme-muted">{emptyMessage}</p>;

  return (
    <div>
      <div className="flex h-7 w-full overflow-hidden rounded-lg border border-theme">
        {segments.map((seg, i) => {
          const pct = (seg.value / total) * 100;
          return (
            <div
              key={seg.label}
              className="h-full transition-all duration-500"
              style={{
                width: `${pct}%`,
                backgroundColor: seg.fill ?? STACK_PALETTE[i % STACK_PALETTE.length],
              }}
              title={`${seg.label} · ${formatValue(seg.value)} · ${pct.toFixed(1)}%`}
            />
          );
        })}
      </div>
      {showLegend ? (
        <ul className="mt-3 flex flex-col gap-1.5">
          {segments.map((seg, i) => (
            <li key={seg.label} className="flex items-center gap-2 text-xs">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: seg.fill ?? STACK_PALETTE[i % STACK_PALETTE.length] }}
              />
              <span className="min-w-0 flex-1 truncate text-theme">{seg.label}</span>
              <span className="shrink-0 text-theme-muted">{formatValue(seg.value)}</span>
              <span className="w-12 shrink-0 text-right font-medium text-theme-strong">
                {((seg.value / total) * 100).toFixed(0)}%
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Donut                                                                */
/* ------------------------------------------------------------------ */

const R = 42;
const STROKE = 14;
const C = 2 * Math.PI * R;

/**
 * Donut with a centred total. `centerLabel` / `centerValue` sit in the hole.
 *
 * Built from `stroke-dasharray` arcs on a single circle rather than path maths,
 * which keeps it exact for any number of segments and needs no trigonometry.
 */
export function Donut({
  segments,
  centerLabel,
  centerValue,
  formatValue = formatBDT,
  emptyMessage = "Nothing to split yet.",
}: {
  segments: StackSegment[];
  centerLabel: string;
  centerValue: string;
  formatValue?: (value: number) => string;
  emptyMessage?: string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (!total) {
    return (
      <div className="flex flex-col items-center justify-center py-6">
        <p className="text-xs text-theme-muted">{emptyMessage}</p>
      </div>
    );
  }

  // A zero-length dash renders nothing but still consumes a slot in the
  // dasharray, so it is filtered out rather than clamped to a hairline.
  // `cum` is the running fraction BEFORE each arc, so the offsets come from one
  // pass — mutating a shared counter across `.map` is what React Compiler's
  // immutability rule rejects.
  const cum = segments
    .filter((s) => s.value > 0)
    .map((s) => s.value)
    .reduce<number[]>((acc, v) => [...acc, acc[acc.length - 1] + v / total], [0])
    .slice(0, -1);

  const arcs = segments
    .filter((s) => s.value > 0)
    .map((s, i) => {
      const frac = s.value / total;
      return {
        key: s.label,
        color: s.fill ?? STACK_PALETTE[i % STACK_PALETTE.length],
        dasharray: `${frac * C} ${C - frac * C}`,
        offset: -(cum[i] ?? 0) * C,
        label: `${s.label} · ${formatValue(s.value)} · ${(frac * 100).toFixed(1)}%`,
      };
    });

  return (
    <div className="flex flex-wrap items-center justify-center gap-6">
      <svg
        viewBox="0 0 120 120"
        className="h-40 w-40 shrink-0"
        role="img"
        aria-label={`${centerLabel}: ${centerValue}`}
      >
        <circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          stroke="var(--theme-border)"
          strokeWidth={STROKE}
        />
        {arcs.map((a) => (
          <circle
            key={a.key}
            cx="60"
            cy="60"
            r={R}
            fill="none"
            stroke={a.color}
            strokeWidth={STROKE}
            strokeDasharray={a.dasharray}
            strokeDashoffset={a.offset}
            // Start at 12 o'clock instead of 3 o'clock.
            transform="rotate(-90 60 60)"
          >
            <title>{a.label}</title>
          </circle>
        ))}
        <text
          x="60"
          y="57"
          textAnchor="middle"
          className="fill-[var(--theme-fg-strong)] text-[15px] font-bold"
        >
          {centerValue}
        </text>
        <text
          x="60"
          y="72"
          textAnchor="middle"
          className="fill-[var(--theme-muted)] text-[8px]"
        >
          {centerLabel}
        </text>
      </svg>
      <ul className="flex min-w-40 flex-1 flex-col gap-1.5">
        {segments.map((seg, i) => (
          <li key={seg.label} className="flex items-center gap-2 text-xs">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: seg.fill ?? STACK_PALETTE[i % STACK_PALETTE.length] }}
            />
            <span className="min-w-0 flex-1 truncate text-theme">{seg.label}</span>
            <span className="shrink-0 text-theme-muted">{formatValue(seg.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Aging columns                                                        */
/* ------------------------------------------------------------------ */

export type AgingColumn = {
  key: string;
  label: string;
  count: number;
  amount: number;
  severity: 0 | 1 | 2 | 3;
};

/**
 * Vertical bucket columns for the bills register's aging.
 *
 * The buckets are read off the MANUAL `overdueDays` typed in col G, which is the
 * single source of truth for the cell, the `overdue=only` filter and the
 * `overdueDesc` sort on the Pending Bills list. Recomputing this from `dueOn`
 * here would make the dashboard disagree with that page. Amount is the bar
 * height; the count sits under the label so both readings are available.
 */
export function AgingChart({
  buckets,
  formatValue = formatBDT,
  hrefFor,
}: {
  buckets: AgingColumn[];
  formatValue?: (value: number) => string;
  /** Optional deep link per bucket, so a column opens the matching filtered list. */
  hrefFor?: (b: AgingColumn) => string | null;
}) {
  const max = Math.max(...buckets.map((b) => b.amount), 1);
  const any = buckets.some((b) => b.count > 0);
  if (!any) {
    return <p className="py-10 text-center text-xs text-theme-muted">No open bills to age.</p>;
  }

  return (
    <div className="flex items-end gap-1.5 sm:gap-3">
      {buckets.map((b) => {
        const href = hrefFor?.(b) ?? null;
        const bar = (
          <div className="flex h-full flex-col items-center justify-end gap-1.5">
            <span className="text-[10px] font-medium text-theme-strong">
              {b.amount > 0 ? formatValue(b.amount) : "—"}
            </span>
            <div className="flex w-full flex-1 items-end">
              <div
                className="w-full rounded-t transition-all duration-500"
                style={{
                  height: `${Math.max((b.amount / max) * 100, b.amount > 0 ? 3 : 0)}%`,
                  backgroundColor: SEVERITY_FILL[b.severity],
                  opacity: b.count === 0 ? 0.25 : 1,
                }}
              />
            </div>
            <span className="text-center text-[10px] leading-tight text-theme-muted">
              {b.label}
            </span>
            <span
              className={`text-[10px] font-medium ${
                b.count > 0 ? SEVERITY_TEXT[b.severity] : "text-theme-muted"
              }`}
            >
              {b.count} bill{b.count === 1 ? "" : "s"}
            </span>
          </div>
        );
        return href ? (
          <a
            key={b.key}
            href={href}
            className="h-44 min-w-0 flex-1 rounded-lg transition-opacity hover:opacity-80"
            title={`${b.label} — ${b.count} bill(s), ${formatValue(b.amount)}`}
          >
            {bar}
          </a>
        ) : (
          <div key={b.key} className="h-44 min-w-0 flex-1">
            {bar}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Trend lines                                                          */
/* ------------------------------------------------------------------ */

export type TrendSeries = {
  label: string;
  color: string;
  points: number[];
};

export type TrendPoint = { label: string };

/**
 * Two-series line/area chart over months.
 *
 * `viewBox` + `preserveAspectRatio="none"` on the geometry would distort the
 * stroke, so the SVG is scaled with a real aspect ratio and the labels are drawn
 * in the same coordinate space. Every point carries a `<title>`, which is the
 * native tooltip — no client state, no hover handler.
 *
 * A series of all zeros is drawn as a flat line at the baseline rather than
 * skipped, so "collection is genuinely zero" reads differently from "no data".
 */
export function TrendChart({
  points,
  series,
  formatValue = formatBDT,
  emptyMessage = "No dated entries in this period.",
}: {
  points: TrendPoint[];
  series: TrendSeries[];
  formatValue?: (value: number) => string;
  emptyMessage?: string;
}) {
  if (points.length === 0) return <p className="py-10 text-center text-xs text-theme-muted">{emptyMessage}</p>;

  const W = 100;
  const H = 34;
  const PAD_L = 3;
  const PAD_R = 2;
  const max = Math.max(...series.flatMap((s) => s.points), 1);
  const stepX = points.length > 1 ? (W - PAD_L - PAD_R) / (points.length - 1) : 0;

  const x = (i: number) => PAD_L + (points.length > 1 ? i * stepX : (W - PAD_L - PAD_R) / 2);
  // A little headroom so the tallest point is not flush with the top edge.
  const y = (v: number) => H - 2 - (v / max) * (H - 4);

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-40 w-full"
        role="img"
        aria-label={`Trend: ${series.map((s) => s.label).join(" and ")}`}
      >
        {[0.25, 0.5, 0.75, 1].map((g) => (
          <line
            key={g}
            x1={0}
            x2={W}
            y1={y(max * g)}
            y2={y(max * g)}
            stroke="var(--theme-border)"
            strokeWidth={0.2}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {series.map((s) => {
          const d = s.points
            .map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(v).toFixed(2)}`)
            .join(" ");
          const area = `${d} L${x(s.points.length - 1).toFixed(2)},${H} L${x(0).toFixed(2)},${H} Z`;
          return (
            <g key={s.label}>
              <path d={area} fill={s.color} opacity={0.12} />
              <path
                d={d}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              {s.points.map((v, i) => (
                <circle
                  key={i}
                  cx={x(i)}
                  cy={y(v)}
                  r={0.9}
                  fill={s.color}
                  vectorEffect="non-scaling-stroke"
                >
                  <title>{`${points[i].label} · ${s.label}: ${formatValue(v)}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex justify-between text-[10px] text-theme-muted">
        <span>{points[0]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </div>
      <ul className="mt-2 flex flex-wrap gap-4">
        {series.map((s) => (
          <li key={s.label} className="flex items-center gap-1.5 text-xs">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
            <span className="text-theme">{s.label}</span>
            <span className="font-medium text-theme-strong">
              {formatValue(s.points.reduce((a, b) => a + b, 0))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Meter rows                                                           */
/* ------------------------------------------------------------------ */

export type Meter = {
  label: string;
  value: number;
  color?: string;
};

/**
 * Compact proportional bars with a label, a value and a count — used for the
 * credit-term spread and the entry-department split. Thinner than `BarChart`
 * because these sit in a narrow column beside a chart.
 */
export function MeterRow({
  meters,
  formatValue = formatNumber,
  showCount = true,
}: {
  meters: Meter[];
  formatValue?: (value: number) => string;
  showCount?: boolean;
}) {
  const max = Math.max(...meters.map((m) => m.value), 1);
  const total = meters.reduce((s, m) => s + m.value, 0);
  if (total === 0) {
    return <p className="py-6 text-center text-xs text-theme-muted">Nothing recorded yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-2.5">
      {meters.map((m) => (
        <li key={m.label}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
            <span className="min-w-0 truncate text-theme">{m.label}</span>
            <span className="shrink-0 font-medium text-theme-strong">
              {formatValue(m.value)}
              {showCount ? <span className="ml-1 text-theme-muted">{m.label}</span> : null}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.04]">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.max((m.value / max) * 100, 2)}%`,
                backgroundColor: m.color ?? "var(--color-indigo-500)",
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Proportion row (two-figure split)                                    */
/* ------------------------------------------------------------------ */

/**
 * A single bar split into at most two parts with inline figures — the shape that
 * answers "how much of X is Y" without a whole chart.
 */
export function SplitBar({
  leftLabel,
  leftValue,
  rightLabel,
  rightValue,
  formatValue = formatBDT,
}: {
  leftLabel: string;
  leftValue: number;
  rightLabel: string;
  rightValue: number;
  formatValue?: (value: number) => string;
}) {
  const total = leftValue + rightValue;
  const leftPct = total > 0 ? (leftValue / total) * 100 : 50;
  return (
    <div>
      <div className="flex h-6 w-full overflow-hidden rounded-lg border border-theme">
        <div
          className="h-full bg-rose-500/70"
          style={{ width: `${leftPct}%` }}
          title={`${leftLabel}: ${formatValue(leftValue)}`}
        />
        <div
          className="h-full flex-1 bg-emerald-500/60"
          style={{ width: `${100 - leftPct}%` }}
          title={`${rightLabel}: ${formatValue(rightValue)}`}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-rose-500/70" />
          <span className="text-theme-muted">{leftLabel}</span>
          <span className="font-medium text-theme-strong">{formatValue(leftValue)}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500/60" />
          <span className="text-theme-muted">{rightLabel}</span>
          <span className="font-medium text-theme-strong">{formatValue(rightValue)}</span>
        </span>
      </div>
    </div>
  );
}
