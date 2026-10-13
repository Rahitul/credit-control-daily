import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  FileClock,
  PhoneCall,
  UserCheck,
  Wallet,
} from "lucide-react";
import { hasRole } from "@/lib/auth";
import { formatBDT, formatDate, formatNumber } from "@/lib/format";
import { homeForRoles } from "@/lib/nav";
import { DASHBOARD_RANGES, getOverview, type DashboardRange } from "@/lib/dashboard";
import { PAYMENT_APPROVER_ROLES } from "@/lib/nav";
import { ROLE_LABELS, type SessionUser } from "@/lib/types";
import { PageHeader, StatCard, EmptyState, BarChart } from "@/components/ui";
import {
  AgingChart,
  ChartCard,
  Donut,
  MeterRow,
  SplitBar,
  StackedBar,
  TrendChart,
} from "@/components/charts";

export const dynamic = "force-dynamic";

/**
 * The Admin / Accounts overview.
 *
 * The four department apps keep using `DashboardView` — this is deliberately a
 * separate, consolidated view for the two roles that are supposed to see
 * everything at a glance, and it is unscoped by department for exactly that
 * reason (Accounts/Admin see every bill, routed or not).
 *
 * Two registers are on this page and they answer different questions, so every
 * figure is labelled with the one it came from:
 *
 * - **Bills register** (`PendingBill.pendingAmount`) holds the real receivable —
 *   ~95% of the money. Its "overdue" is the MANUAL `overdueDays` in col G.
 * - **Sales register** (`Sale` + FIFO payments) drives terms, the credit-term
 *   view and `totalSales`. Its "overdue" is `saleDate + creditLimitDays`.
 *
 * `outstanding` is summed from the credit rows, never recomputed as
 * `sales − collected`.
 */
export async function OverviewDashboard({
  user,
  range,
}: {
  user: SessionUser;
  range: DashboardRange;
}) {
  const home = homeForRoles(user.roles);
  const isAdmin = hasRole(user, "admin");
  const canApprove = hasRole(user, ...PAYMENT_APPROVER_ROLES);

  const data = await getOverview({
    range,
    viewer: { id: user.id, roles: user.roles },
    isAdmin,
  });

  const {
    money,
    customers,
    bills,
    aging,
    routes,
    entryDepts,
    months,
    paymentTypes,
    bankTypes,
    terms,
    topByOutstanding,
    topOverdueParties,
    overduePartiesCount,
    recentPayments,
    attention,
    attentionBills,
    recentActivity,
    agedOver90Cutoff,
  } = data;

  const collectionPct = money.sales > 0 ? (money.collectionRate * 100).toFixed(1) : "0.0";
  const routeTotal = routes.reduce((s, r) => s + r.amount, 0);
  const rangeIsAllTime = range === "all" || range === "mtd";

  /* A period tab is only meaningful for figures that are actually dated.
     Cumulative registers stay all-time, and say so, rather than being filtered
     into a number that disagrees with the list pages. */
  const periodNote = rangeIsAllTime
    ? "Cumulative figures below are all-time and match the register pages exactly."
    : `Sales and collection are scoped to ${data.rangeLabel.toLowerCase()}. Cumulative figures (outstanding, bills, customers) stay all-time so they keep matching the register pages.`;

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle={`${user.roles.map((r) => ROLE_LABELS[r]).join(" · ")} · ${formatDate(new Date())}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`${home}/pending-bills`} className="btn-ghost">
              <FileClock className="mr-1 inline h-3.5 w-3.5" />
              Pending Bills
            </Link>
            <Link href={`${home}/completed-bills`} className="btn-ghost">
              Completed Bills
            </Link>
            <Link href={`${home}/customers`} className="btn-ghost">
              Customers
            </Link>
            <Link href={`${home}/payments`} className="btn-ghost">
              Payments
            </Link>
          </div>
        }
      />

      {/* Period tabs — GET form, server-rendered, so the selection survives a
          reload and the page stays shareable. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form method="GET" className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs uppercase tracking-wider text-theme-muted">
            Period
          </span>
          {DASHBOARD_RANGES.map((r) => (
            <button
              key={r.key}
              type="submit"
              name="range"
              value={r.key}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                range === r.key
                  ? "border-indigo-500/60 bg-indigo-600/20 text-theme-strong"
                  : "border-theme text-theme-muted hover:bg-theme-surface-hover"
              }`}
            >
              {r.label}
            </button>
          ))}
        </form>
        <p className="text-xs text-theme-muted">{periodNote}</p>
      </div>

      {/* ---- Money at a glance: two grids of 3, the app-wide convention ---- */}
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-theme-muted">
        Money at a glance
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Total Outstanding"
          value={formatBDT(money.outstanding)}
          accent="amber"
          hint="Open pending bills — bills register only. Sale balances are not added."
          href={`${home}/pending-bills`}
        />
        <StatCard
          label="Total Company Sales"
          value={formatBDT(money.sales)}
          accent="green"
          hint="Sales register, all time"
          href={`${home}/sales`}
        />
        <StatCard
          label="Total Collected"
          value={formatBDT(money.collected)}
          accent="indigo"
          hint="Approved payments only"
          href={`${home}/payments?status=approved`}
        />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Bills Overdue"
          value={formatBDT(bills.overdueAmount)}
          accent={bills.overdueCount > 0 ? "red" : "indigo"}
          hint={
            bills.overdueCount > 0
              ? `${bills.overdueCount} bill(s) flagged overdue by hand (col G) — these are the alerts`
              : "No bill carries a manual overdue aging"
          }
          href="/admin/alerts"
        />
        <StatCard
          label="Parties With Overdue Bills"
          value={String(overduePartiesCount)}
          accent={overduePartiesCount > 0 ? "red" : "indigo"}
          hint={
            overduePartiesCount > 0
              ? `${overduePartiesCount} distinct parties across the overdue bills`
              : "No party has an overdue bill"
          }
          href="/admin/alerts"
        />
        <StatCard
          label="Collection Rate"
          value={`${collectionPct}%`}
          accent={money.sales > 0 && money.collectionRate < 0.5 ? "amber" : "green"}
          hint={`${formatBDT(money.collected)} collected of ${formatBDT(money.sales)} sold`}
          href={`${home}/payments?status=approved`}
        />
      </div>

      {/* ---- Register split: the bills register vs the sales register ---- */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Open Bills"
          value={String(bills.count)}
          accent="indigo"
          hint={`${formatBDT(bills.pending)} open of ${formatBDT(bills.opening)} billed`}
          href={`${home}/pending-bills`}
        />
        <StatCard
          label="Customers"
          value={String(customers.approved)}
          accent="purple"
          hint={
            customers.pending > 0
              ? `${customers.approved} approved · ${customers.pending} awaiting approval`
              : `${customers.withSales} with sales · ${customers.withBills} with bills`
          }
          href={`${home}/customers`}
        />
        <StatCard
          label="Avg Payment Term"
          value={`${money.avgTerm} days`}
          accent="purple"
          hint="A term in days, not a money limit"
          href={`${home}/customers`}
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Bills Settled"
          value={String(bills.settledCount)}
          accent="green"
          hint={`${formatBDT(bills.settledAmount)} released against bills`}
          href={`${home}/completed-bills`}
        />
        <StatCard
          label="Avg Bill Age"
          value={`${bills.avgBillAge} days`}
          accent="amber"
          hint="Open bills, whole days from bill date"
          href={`${home}/pending-bills?sort=ageDesc`}
        />
        <StatCard
          label="Bills With Follow-ups"
          value={String(attention.billsWithFollowUps)}
          accent="indigo"
          hint={
            attention.promisesPassed > 0
              ? `${attention.promisesPassed} promise(s) passed their date`
              : "No payment promise has passed"
          }
          href={`${home}/pending-bills`}
        />
      </div>

      {/* ---- Attention required ---- */}
      <h2 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-theme-muted">
        Attention required
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {canApprove ? (
          <AttentionCard
            icon={<Wallet className="h-4 w-4" />}
            label="Payments awaiting approval"
            value={String(attention.pendingPayments)}
            detail={
              attention.pendingPayments > 0
                ? `${formatBDT(attention.pendingPaymentsAmount)} claimed but not yet released against bills`
                : "Approval queue is clear"
            }
            href={`${home}/payments?status=pending`}
            tone={attention.pendingPayments > 0 ? "amber" : "green"}
          />
        ) : null}
        {isAdmin ? (
          <AttentionCard
            icon={<UserCheck className="h-4 w-4" />}
            label="Customers awaiting approval"
            value={String(attention.pendingCustomers)}
            detail={
              attention.pendingCustomers > 0
                ? "Hidden from dashboards and reports until approved"
                : "No customer is waiting on approval"
            }
            href={`${home}/customers?approval=pending`}
            tone={attention.pendingCustomers > 0 ? "amber" : "green"}
          />
        ) : null}
        <AttentionCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Bills flagged overdue"
          value={String(attention.billsFlaggedOverdue)}
          detail={`${formatBDT(attention.billsFlaggedOverdueAmount)} across manually aged bills`}
          href={`${home}/pending-bills?overdue=only`}
          tone={attention.billsFlaggedOverdue > 0 ? "red" : "green"}
        />
        <AttentionCard
          icon={<PhoneCall className="h-4 w-4" />}
          label="Promises passed"
          value={String(attention.promisesPassed)}
          detail={
            attention.promisesPassed > 0
              ? "A promised payment date has gone by without payment"
              : "No promise has passed its date"
          }
          href={`${home}/pending-bills?promise=passed`}
          tone={attention.promisesPassed > 0 ? "red" : "green"}
        />
        <AttentionCard
          icon={<FileClock className="h-4 w-4" />}
          label="Bills older than 90 days"
          value={String(attention.billsAgedOver90)}
          detail={`${formatBDT(attention.billsAgedOver90Amount)} across bills dated on or before ${formatDate(agedOver90Cutoff)}`}
          href={`${home}/pending-bills?minDays=91`}
          tone={attention.billsAgedOver90 > 0 ? "amber" : "green"}
        />
        <AttentionCard
          icon={<CalendarClock className="h-4 w-4" />}
          label="Bills needing attention"
          value={String(attention.billsNeedingAttention)}
          detail="Flagged overdue in col G, or older than 90 days"
          href={`${home}/pending-bills?sort=overdueDesc`}
          tone={attention.billsNeedingAttention > 0 ? "amber" : "green"}
        />
      </div>

      {/* ---- Charts ---- */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Bill Aging"
          subtitle="Outstanding bills by the manual overdue days typed in col G"
          action={
            <Link href={`${home}/pending-bills?overdue=only`} className="btn-ghost">
              View bills
            </Link>
          }
          footer="Col G is entered by hand, so these buckets are read off the stored value. A different number to the sales-register overdue on the card above — that one is computed from sale date plus payment term."
        >
          <AgingChart
            buckets={aging}
            hrefFor={(b) =>
              b.key === "notdue"
                ? `${home}/pending-bills`
                : `${home}/pending-bills?minDays=${agingMinDays(b.key)}`
            }
          />
        </ChartCard>

        <ChartCard
          title="Where the Bills Live"
          subtitle="Outstanding amount by the department app a bill is routed to"
          action={
            <Link href={`${home}/pending-bills`} className="btn-ghost">
              All bills
            </Link>
          }
          footer="Routed from the bill-number prefix. A bill can route to more than one app, so these slices do not sum to the register; “Accounts only” is the slice whose prefix matched no rule."
        >
          {routes.length > 0 ? (
            <Donut
              segments={routes.map((r) => ({ label: r.label, value: r.amount }))}
              centerLabel="outstanding"
              centerValue={formatBDT(routeTotal).replace("৳", "")}
            />
          ) : (
            <EmptyState message="No open bills to route." />
          )}
        </ChartCard>

        <ChartCard
          title="Sales vs Collection"
          subtitle={`By month · ${data.trendLabel.toLowerCase()}`}
          footer="Sales from the sales register; collection counts approved payments only. A pending payment has not been released against a bill, so it is not money in hand."
        >
          <TrendChart
            points={months.map((m) => ({ label: m.label }))}
            series={[
              {
                label: "Sales",
                color: "var(--color-indigo-400)",
                points: months.map((m) => m.sales),
              },
              {
                label: "Collected",
                color: "var(--color-emerald-400)",
                points: months.map((m) => m.collected),
              },
            ]}
          />
        </ChartCard>

        <ChartCard
          title="Bill Proportions"
          subtitle="Overdue vs within terms, and the credit terms in force"
          footer={`Credit limit here is a payment TERM in days, not a money cap. ${money.withinTermCustomers} customer(s) are within terms, ${money.salesOverdueCustomers} are past theirs (sales register).`}
        >
          <div className="flex flex-col gap-5">
            <div>
              <h3 className="mb-2 text-xs font-medium text-theme-muted">
                Open bills by manual aging
              </h3>
              <SplitBar
                leftLabel="Flagged overdue"
                leftValue={bills.overdueAmount}
                rightLabel="Not yet due"
                rightValue={Math.max(bills.pending - bills.overdueAmount, 0)}
              />
            </div>
            <div>
              <h3 className="mb-2 text-xs font-medium text-theme-muted">
                Customers by payment term
              </h3>
              <MeterRow
                showCount={false}
                formatValue={formatNumber}
                meters={terms.map((t) => ({
                  label: `${t.days} day${t.days === 1 ? "" : "s"}`,
                  value: t.count,
                }))}
              />
            </div>
          </div>
        </ChartCard>

        <ChartCard
          title="Payment Type"
          subtitle="Approved payments, grouped by type"
          footer="Approved payments only — a pending payment is a claim, not released money."
        >
          <BarChart
            data={paymentTypes.map((p) => ({ label: p.label, value: p.amount }))}
            formatValue={formatBDT}
            labelWidth="w-32"
            valueWidth="w-28"
            showTotal
            emptyMessage="No payments recorded yet — the collection register is empty."
          />
        </ChartCard>

        <ChartCard
          title="Bank Type"
          subtitle="Approved payments, grouped by bank"
          footer="Falls back to bank name, then to “Cash / Other” when neither is set."
        >
          <BarChart
            data={bankTypes.map((b) => ({ label: b.label, value: b.amount }))}
            formatValue={formatBDT}
            labelWidth="w-32"
            valueWidth="w-28"
            showTotal
            emptyMessage="No payments recorded yet — the collection register is empty."
          />
        </ChartCard>

        <ChartCard
          title="Who Entered the Bills"
          subtitle="Open bills grouped by the department that typed them in"
          footer="This is who ENTERED the bill, not where it is routed — a Consumable user can create a Sales bill. See the routing donut above for that question."
        >
          <StackedBar
            segments={entryDepts.map((d) => ({ label: d.label, value: d.amount }))}
          />
        </ChartCard>

        <ChartCard
          title="Bills by Entry Department"
          subtitle="Counts alongside the amount split"
        >
          <div className="overflow-x-auto">
            <table className="table-dark min-w-[420px]">
              <thead>
                <tr>
                  <th>Entered by</th>
                  <th className="text-right">Bills</th>
                  <th className="text-right">Pending</th>
                </tr>
              </thead>
              <tbody>
                {entryDepts.map((d) => (
                  <tr key={d.label}>
                    <td>{d.label}</td>
                    <td className="text-right">{d.count}</td>
                    <td className="text-right">{formatBDT(d.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>
      </div>

      {/* ---- Tables ---- */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Top Debtors by Open Bills"
          subtitle="Grouped by party across every routed bill"
          action={
            <Link href={`${home}/pending-bills?sort=pendingDesc`} className="btn-ghost">
              All bills
            </Link>
          }
          footer="Sum of `pendingAmount` per party. This is the same money as the Outstanding card, split by name."
        >
          {topByOutstanding.length === 0 ? (
            <EmptyState message="No open bills." />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-dark min-w-[520px]">
                <thead>
                  <tr>
                    <th>Party</th>
                    <th className="text-right">Bills</th>
                    <th className="text-right">Worst aging</th>
                    <th className="text-right">Oldest bill</th>
                    <th className="text-right">Pending</th>
                  </tr>
                </thead>
                <tbody>
                  {topByOutstanding.map((p) => (
                    <tr key={p.name}>
                      <td className="font-medium text-zinc-100">{p.name}</td>
                      <td className="text-right">{p.count}</td>
                      <td className="text-right">
                        {p.maxOverdueDays > 0 ? (
                          <span className="pill pill-red">{p.maxOverdueDays} d</span>
                        ) : (
                          <span className="pill pill-green">—</span>
                        )}
                      </td>
                      <td className="text-right whitespace-nowrap">
                        {formatDate(p.oldestBillDate)}
                      </td>
                      <td className="text-right font-semibold text-amber-300">
                        {formatBDT(p.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ChartCard>

        <ChartCard
          title="Top Overdue Parties"
          subtitle="Bills register — parties grouped by their overdue bills"
          action={
            <Link href="/admin/alerts" className="btn-ghost">
              Full alerts
            </Link>
          }
          footer="Grouped from the pending bills flagged overdue in col G. This is the same set as the Overdue Alerts page, so the two can never disagree."
        >
          {topOverdueParties.length === 0 ? (
            <EmptyState message="No party has an overdue bill." />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-dark min-w-[520px]">
                <thead>
                  <tr>
                    <th>Party</th>
                    <th className="text-right">Overdue Bills</th>
                    <th className="text-right">Worst Aging</th>
                    <th className="text-right">Overdue Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {topOverdueParties.map((p) => (
                    <tr key={p.name}>
                      <td className="font-medium text-zinc-100">{p.name}</td>
                      <td className="text-right">{p.count}</td>
                      <td className="text-right">
                        <span className="pill pill-red">{p.maxOverdueDays} d</span>
                      </td>
                      <td className="text-right font-semibold text-rose-400">
                        {formatBDT(p.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ChartCard>

        <ChartCard
          title="Bills Needing Attention"
          subtitle="Oldest and most overdue first"
          action={
            <Link href={`${home}/pending-bills?sort=overdueDesc`} className="btn-ghost">
              Review all
            </Link>
          }
          footer={`A bill lands here when it is flagged overdue in col G or is older than 90 days. Showing the ${attentionBills.length} most overdue of ${attention.billsNeedingAttention} such bills.`}
        >
          {attentionBills.length === 0 ? (
            <EmptyState message="Nothing needs chasing right now." />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-dark min-w-[620px]">
                <thead>
                  <tr>
                    <th>Bill</th>
                    <th>Party</th>
                    <th className="text-right">Overdue by</th>
                    <th className="text-right">Age</th>
                    <th className="text-right">Pending</th>
                  </tr>
                </thead>
                <tbody>
                  {attentionBills.map((b) => (
                    <tr key={b.id}>
                      <td>
                        <Link
                          href={`${home}/pending-bills/${b.id}/edit`}
                          className="font-mono text-xs hover:underline"
                        >
                          {b.billNumber}
                        </Link>
                        {b.warnings.length > 0 ? (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {b.warnings.map((w) => (
                              <span key={w} className="pill pill-amber">
                                {w}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap">{b.partyName}</td>
                      <td className="text-right">
                        {b.overdueDays > 0 ? (
                          <span className="pill pill-red">{b.overdueDays} d</span>
                        ) : b.promise === "passed" ? (
                          <span className="pill pill-amber">Promise passed</span>
                        ) : (
                          <span className="pill pill-zinc">Aged {b.age} d</span>
                        )}
                      </td>
                      <td className="text-right">{b.age} d</td>
                      <td className="text-right font-semibold text-amber-300">
                        {formatBDT(b.pendingAmount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ChartCard>

        <ChartCard
          title="Recent Approved Payments"
          subtitle="Money actually released against bills"
          action={
            <Link href={`${home}/payments`} className="btn-ghost">
              All payments
            </Link>
          }
          footer="Approved only. A pending payment has not moved any bill yet, so it is deliberately absent here and from every collected figure on this page."
        >
          {recentPayments.length === 0 ? (
            <EmptyState message="No payments recorded yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-dark min-w-[560px]">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>Type</th>
                    <th>Bank</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {recentPayments.map((p) => (
                    <tr key={p.id}>
                      <td className="whitespace-nowrap">{formatDate(p.date)}</td>
                      <td className="font-medium text-zinc-100">{p.customer}</td>
                      <td>
                        <span className="pill pill-indigo">{p.paymentType}</span>
                      </td>
                      <td className="whitespace-nowrap">{p.bank}</td>
                      <td className="text-right font-semibold text-emerald-300">
                        {formatBDT(p.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ChartCard>
      </div>

      {isAdmin ? (
        <div className="mt-6">
          <ChartCard
            title="Recent Activity"
            subtitle="Every create, edit, import and approval"
            action={
              <Link href="/admin/activity" className="btn-ghost">
                Full log <ArrowRight className="ml-1 inline h-3 w-3" />
              </Link>
            }
          >
            {recentActivity.length === 0 ? (
              <EmptyState message="No activity recorded yet." />
            ) : (
              <ul className="flex flex-col divide-y divide-theme">
                {recentActivity.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-xs">
                    <span className="font-medium text-theme-strong">{a.userName}</span>
                    <span className="pill pill-zinc">{a.action}</span>
                    <span className="text-theme-muted">{a.module}</span>
                    {a.detail ? (
                      <span className="min-w-0 flex-1 truncate text-theme-muted">{a.detail}</span>
                    ) : null}
                    <span className="ml-auto shrink-0 text-theme-muted">
                      {formatDate(a.timestamp)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </ChartCard>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Small local pieces                                                   */
/* ------------------------------------------------------------------ */

const ATTENTION_TONES = {
  amber: "border-amber-500/50 bg-[#78350f]",
  red: "border-red-500/50 bg-[#7f1d1d]",
  green: "border-emerald-500/50 bg-[#14532d]",
} as const;

/**
 * One actionable item. `href` is not optional: a number nobody can act on is
 * just decoration, so every attention card opens the list it is counting.
 */
function AttentionCard({
  icon,
  label,
  value,
  detail,
  href,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  href: string;
  tone: keyof typeof ATTENTION_TONES;
}) {
  return (
    <Link
      href={href}
      className={`solid-card flex items-start gap-3 rounded-xl border p-4 transition-colors hover:brightness-110 ${ATTENTION_TONES[tone]}`}
    >
      <span className="mt-0.5 shrink-0 text-zinc-200">{icon}</span>
      <span className="min-w-0">
        <span className="block text-xs font-medium uppercase tracking-wider text-zinc-300">
          {label}
        </span>
        <span className="mt-1 block text-xl font-bold text-white">{value}</span>
        <span className="mt-0.5 block text-xs text-zinc-400">{detail}</span>
      </span>
      <ArrowRight className="mt-1 ml-auto h-3.5 w-3.5 shrink-0 text-zinc-400" />
    </Link>
  );
}

/**
 * Bucket key → the "at least N days old" bound the Pending Bills list understands.
 * The list turns `minDays` into a `billDate` window rather than querying a stored
 * age, which is the same predicate, so the two can never disagree.
 */
function agingMinDays(key: string): number {
  switch (key) {
    case "1-7":
      return 1;
    case "8-14":
      return 8;
    case "15-30":
      return 15;
    case "31-60":
      return 31;
    case "61-90":
      return 61;
    case "90+":
      return 91;
    default:
      return 1;
  }
}

