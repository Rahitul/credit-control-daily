import Link from "next/link";

export function PageHeader({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-theme-strong sm:text-2xl">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-theme-muted">{subtitle}</p>
        ) : null}
      </div>
      {actions ?? children ? (
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {children}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Dashboard stat tile.
 *
 * `href` makes the whole card a link into the list it summarises — the point of
 * a dashboard is that every number is one click from the rows behind it, so the
 * card and its destination have to be declared together or they drift.
 */
export function StatCard({
  label,
  value,
  hint,
  accent = "indigo",
  href,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: "indigo" | "green" | "red" | "amber" | "purple";
  href?: string;
}) {
  const accents: Record<string, string> = {
    indigo: "text-white",
    green: "text-white",
    red: "text-white",
    amber: "text-white",
    purple: "text-white",
  };
  const backgrounds: Record<string, string> = {
    indigo: "bg-[#1e1b4b] border-indigo-500/50",
    green: "bg-[#14532d] border-emerald-500/50",
    red: "bg-[#7f1d1d] border-red-500/50",
    amber: "bg-[#78350f] border-amber-500/50",
    purple: "bg-[#4c1d95] border-purple-500/50",
  };
  const body = (
    <>
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-300">
        {label}
      </p>
      <p className={`mt-2 text-xl font-bold sm:text-2xl ${accents[accent]}`}>
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-zinc-400">{hint}</p> : null}
    </>
  );
  const className = `solid-card rounded-xl border p-4 transition-colors sm:p-5 ${backgrounds[accent]}`;
  if (href) {
    return (
      <Link href={href} className={`block ${className} hover:brightness-110`}>
        {body}
      </Link>
    );
  }
  return <div className={className}>{body}</div>;
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-theme bg-theme-surface px-6 py-12 text-center text-sm text-theme-muted">
      {message}
    </div>
  );
}

/**
 * Horizontal bar chart.
 *
 * The label and value columns are width props rather than the hard-coded
 * `w-28` / `w-24` this used to carry: a party name needs far more room than a
 * payment type, and a ৳ amount needs far more than a count. `formatValue`
 * defaults to a plain grouped number so existing callers keep their output, and
 * `showTotal` appends each bar's share of the total — which is the only way to
 * read a proportional breakdown (routing, payment mix) off a bar chart.
 */
export function BarChart({
  data,
  labelWidth = "w-28",
  valueWidth = "w-24",
  formatValue,
  showTotal = false,
  emptyMessage,
}: {
  data: { label: string; value: number }[];
  labelWidth?: string;
  valueWidth?: string;
  formatValue?: (value: number) => string;
  showTotal?: boolean;
  emptyMessage?: string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const total = data.reduce((s, d) => s + d.value, 0);
  const fmt = formatValue ?? ((v: number) => v.toLocaleString("en-BD"));

  if (data.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-theme-muted">
        {emptyMessage ?? "No data yet."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-3">
          <span
            className={`${labelWidth} shrink-0 truncate text-xs text-theme-muted`}
            title={d.label}
          >
            {d.label}
          </span>
          <div className="h-5 flex-1 overflow-hidden rounded-md bg-white/[0.04]">
            <div
              className="h-full rounded-md bg-gradient-to-r from-indigo-600 to-purple-600 transition-all duration-500"
              style={{ width: `${Math.max((d.value / max) * 100, 2)}%` }}
            />
          </div>
          <span className={`${valueWidth} shrink-0 text-right text-xs font-medium text-theme`}>
            {fmt(d.value)}
            {showTotal && total > 0 ? (
              <span className="ml-1 text-theme-muted">
                {((d.value / total) * 100).toFixed(0)}%
              </span>
            ) : null}
          </span>
        </div>
      ))}
    </div>
  );
}
