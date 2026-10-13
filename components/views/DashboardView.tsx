import Link from "next/link";
import { hasRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { Payment } from "@/lib/models/Payment";
import { getCustomerCredits } from "@/lib/credit";
import { formatBDT, formatDate } from "@/lib/format";
import { homeForRoles } from "@/lib/nav";
import { PageHeader, StatCard, EmptyState, BarChart } from "@/components/ui";
import { ROLE_LABELS, type Role, type SessionUser } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The department-app dashboard. `department` scopes the money cards, the
 * category summary, the payment-type chart and recent payments to that one
 * app — sales/bills by their routing `departments` field, payments by the
 * `createdByRole` entry snapshot (payments have no routing field). Customer
 * counts stay company-wide. Accounts/Admin do NOT use this component; their
 * `OverviewDashboard` is deliberately unscoped.
 */
export async function DashboardView({
  user,
  department = null,
}: {
  user: SessionUser;
  department?: Role | null;
}) {
  await db();

  // Branches app: sales/bills additionally pin to the viewer's branch, exactly
  // like its list pages. A branches user with no branchId set sees all branches.
  const branchId =
    department === "branches" && user.branchId ? String(user.branchId) : undefined;

  const rows = await getCustomerCredits({ department, branchId });
  const totalSales = rows.reduce((s, r) => s + r.totalSales, 0);
  // Sum the per-customer `outstanding` rather than subtracting sales from collected
  // here. The two are no longer the same number: `outstanding` is the bills register
  // only, and computing it locally would disagree with the Customer list and the
  // Pending Bills pages.
  const totalOutstanding = rows.reduce((s, r) => s + r.outstanding, 0);
  const totalOverdueAmount = rows.reduce((s, r) => s + r.overdueAmount, 0);
  const overdueList = rows.filter((r) => r.status === "overdue");
  const within = rows.length - overdueList.length;
  const avgTerms =
    rows.length > 0
      ? Math.round(rows.reduce((s, r) => s + r.creditLimitDays, 0) / rows.length)
      : 0;

  // Recent-payments list and the by-type chart both show released money only, so
  // they agree with Outstanding / Overdue on the stat cards above them (which come
  // from `getCustomerCredits`, which is approved-only). A department dashboard
  // narrows both to payments it entered (`createdByRole`).
  const paymentMatch: Record<string, unknown> = { approvalStatus: "approved" };
  if (department) paymentMatch.createdByRole = department;
  const recentPayments = await Payment.find(paymentMatch)
    .sort({ createdAt: -1 })
    .limit(8)
    .lean()
    .exec();
  const custMap = new Map(rows.map((r) => [r.customerId, r]));

  const isAdmin = hasRole(user, "admin");

  const grouped = rows.reduce<Record<string, typeof rows>>((acc, r) => {
    (acc[r.category || "Uncategorized"] ??= []).push(r);
    return acc;
  }, {});

  const deptStats = Object.entries(grouped).map(([dept, list]) => {
    const items = list ?? [];
    return {
      dept,
      count: items.length,
      outstanding: items.reduce((s, r) => s + r.outstanding, 0),
      over: items.filter((r) => r.status === "overdue").length,
    };
  });

  const paymentTypeData = await Payment.aggregate<{ _id: string; total: number }>([
    { $match: paymentMatch },
    { $group: { _id: "$paymentType", total: { $sum: "$rcvAmount" } } },
    { $sort: { total: -1 } },
  ]);

  const home = homeForRoles(user.roles);

  return (
    <div>
      <PageHeader
        title={`Welcome, ${user.name.split(" ")[0]}`}
        subtitle={`${user.roles.map((r) => ROLE_LABELS[r]).join(" · ")}${
          department ? ` · ${ROLE_LABELS[department]} data` : ""
        }`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`${home}/dropdowns`} className="btn-ghost">
              Manage Dropdowns
            </Link>
            <Link href={`${home}/customers`} className="btn-ghost">
              View Customers
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Total Company Sales"
          value={formatBDT(totalSales)}
          accent="green"
          hint="Sum of all sales"
        />
        <StatCard
          label="Total Customers"
          value={String(rows.length)}
          accent="indigo"
          hint={`${deptStats.length} categories`}
        />
        <StatCard
          label="Avg Payment Terms"
          value={`${avgTerms} days`}
          accent="purple"
          hint="Credit limit = days to pay"
        />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Total Outstanding"
          value={formatBDT(totalOutstanding)}
          accent="amber"
          hint="Total sales − collected"
        />
        <StatCard
          label="Overdue amount"
          value={formatBDT(totalOverdueAmount)}
          accent={totalOverdueAmount > 0 ? "red" : "indigo"}
          hint={
            totalOverdueAmount > 0
              ? `Unpaid past selected payment days · ${overdueList.length} customer(s)`
              : "No bills past their payment terms"
          }
        />
        <StatCard
          label="Overdue Customers"
          value={String(overdueList.length)}
          accent={overdueList.length > 0 ? "red" : "indigo"}
          hint={
            totalOverdueAmount > 0
              ? `${formatBDT(totalOverdueAmount)} past due`
              : `${within} within terms`
          }
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="solid-card rounded-xl border border-indigo-500/50 bg-[#1e1b4b] p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-300">
            Category Summary
          </h2>
          <div className="overflow-x-auto">
            <table className="table-dark">
              <thead>
                <tr>
                  <th className="!text-white">Category</th>
                  <th className="!text-right !text-white">Customers</th>
                  <th className="!text-right !text-white">Outstanding</th>
                  <th className="!text-right !text-white">Overdue</th>
                </tr>
              </thead>
              <tbody>
                {deptStats.map((d) => (
                  <tr key={d.dept}>
                    <td className="font-medium text-zinc-200">{d.dept}</td>
                    <td className="text-right">{d.count}</td>
                    <td className="text-right">{formatBDT(d.outstanding)}</td>
                    <td className="text-right">
                      {d.over > 0 ? (
                        <span className="pill pill-red">{d.over}</span>
                      ) : (
                        <span className="pill pill-green">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="solid-card rounded-xl border border-purple-500/50 bg-[#4c1d95] p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-300">
            Payment Type Breakdown
          </h2>
          <BarChart
            data={paymentTypeData.map((p) => ({
              label: p._id ?? "Other",
              value: p.total,
            }))}
          />
          <p className="mt-3 text-xs text-zinc-300">
            Total collected:{" "}
            <span className="font-medium text-white">
              {formatBDT(paymentTypeData.reduce((s, p) => s + p.total, 0))}
            </span>
          </p>
        </div>
      </div>

      {isAdmin && (
        <div className="solid-card mt-6 rounded-xl border border-red-500/50 bg-[#7f1d1d] p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
              Overdue Alerts
            </h2>
            <Link href="/admin/alerts" className="text-xs text-red-200 hover:text-white">
              View all →
            </Link>
          </div>
          {overdueList.length === 0 ? (
            <p className="rounded-lg bg-black/20 px-6 py-8 text-center text-sm text-zinc-400">
              No customers have bills past their payment terms.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {overdueList.slice(0, 6).map((r) => (
                <div
                  key={r.customerId}
                  className="rounded-lg border border-red-400/30 bg-black/20 p-3"
                >
                  <p className="font-medium text-white">{r.name}</p>
                  <p className="mt-1 text-xs text-zinc-300">
                    <span className="text-red-200">{formatBDT(r.overdueAmount)}</span>{" "}
                    overdue · {r.daysOverdue} day(s) late
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    Terms: {r.creditLimitDays} days · Outstanding {formatBDT(r.outstanding)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="solid-card mt-6 rounded-xl border border-amber-500/50 bg-[#78350f] p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
            Recent Payments
          </h2>
          <Link href={`${home}/payments`} className="text-xs text-amber-200 hover:text-white">
            View all →
          </Link>
        </div>
        {recentPayments.length === 0 ? (
          <EmptyState message="No payments recorded yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-dark">
              <thead>
                <tr>
                  <th className="!text-white">Date</th>
                  <th className="!text-white">Customer</th>
                  <th className="!text-white">Type</th>
                  <th className="!text-right !text-white">Amount</th>
                  <th className="!text-white">Entry By</th>
                </tr>
              </thead>
              <tbody>
                {recentPayments.map((p) => {
                  const c = custMap.get(String(p.customerId));
                  return (
                    <tr key={String(p._id)}>
                      <td>{formatDate(p.rcvDate)}</td>
                      <td className="font-medium text-zinc-200">{c?.name ?? "—"}</td>
                      <td>{p.paymentType}</td>
                      <td className="text-right">{formatBDT(p.rcvAmount)}</td>
                      <td>{p.entryBy ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalSales === 0 && recentPayments.length === 0 ? (
        <p className="mt-6 text-center text-xs text-zinc-600">
          Sale last synced just now · {formatDate(new Date())}
        </p>
      ) : null}
    </div>
  );
}
