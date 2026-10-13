import { requireRole } from "@/lib/auth";
import { BILL_ROUTES, escapeRegex } from "@/lib/pendingBills";
import { PendingBill } from "@/lib/models/PendingBill";
import { formatBDT, formatDate } from "@/lib/format";
import { ROLE_LABELS, type Role } from "@/lib/types";
import { PageHeader, EmptyState } from "@/components/ui";
import {
  FilterBar,
  FilterLabel,
  fstr,
  hasAnyFilter,
  type SearchParams,
} from "@/components/filters";

export const dynamic = "force-dynamic";

/**
 * Overdue alerts are driven by the BILLS register, not the sales register.
 *
 * A bill becomes an alert the moment someone types an aging into col G
 * (`overdueDays`) — that manual figure is the whole point of the register, and it
 * is the number the Pending Bills list, the dashboard and this page all read. The
 * sales-register overdue (`saleDate + creditTermDays`) is a different question and
 * lives on the Customers page, so it is deliberately not mixed in here.
 *
 * The filter set mirrors the Pending Bills list (party, bill-date range, due-on
 * range, pending range, overdue-days range, routed-to, entered-by, sort) so an
 * alert can be narrowed the same way the register can. The one filter deliberately
 * absent is "overdue only" — every row here is already overdue, so it would be a
 * no-op.
 */
type AlertBill = {
  _id: unknown;
  billNumber: string;
  referenceNo: string;
  partyName: string;
  billDate: Date;
  overdueDays: number;
  pendingAmount: number;
  dueOn: Date | null;
  createdByRole?: string;
  departments: Role[];
};

const FILTER_KEYS = [
  "q",
  "party",
  "dateFrom",
  "dateTo",
  "dueFrom",
  "dueTo",
  "minPending",
  "maxPending",
  "minDays",
  "maxDays",
  "route",
  "dept",
  "sort",
];

/** Sorts that work on stored fields (no derived `dueTs`/`daysSinceBill`). */
const ALERT_SORTS: Record<string, Record<string, 1 | -1>> = {
  overdueDesc: { overdueDays: -1, pendingAmount: -1 },
  overdueAsc: { overdueDays: 1, pendingAmount: -1 },
  pendingDesc: { pendingAmount: -1 },
  pendingAsc: { pendingAmount: 1 },
  dateDesc: { billDate: -1 },
  dateAsc: { billDate: 1 },
  dueAsc: { dueOn: 1, billDate: 1 },
  dueDesc: { dueOn: -1, billDate: 1 },
  partyAsc: { partyName: 1, billDate: 1 },
  billNoAsc: { billNumber: 1, billDate: 1 },
  billNoDesc: { billNumber: -1, billDate: -1 },
};

const ALERT_SORT_LABELS: Record<string, string> = {
  overdueDesc: "Overdue most",
  overdueAsc: "Overdue least",
  pendingDesc: "Pending high",
  pendingAsc: "Pending low",
  dateDesc: "Date (new)",
  dateAsc: "Date (old)",
  dueAsc: "Due soonest",
  dueDesc: "Due latest",
  partyAsc: "Party A–Z",
  billNoAsc: "Bill no. A–Z",
  billNoDesc: "Bill no. Z–A",
};

function deptLabelFor(key: string) {
  return key && key in ROLE_LABELS ? ROLE_LABELS[key as Role] : key;
}

function dayStart(v: string): Date | null {
  if (!v) return null;
  const d = new Date(`${v}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dayEnd(v: string): Date | null {
  if (!v) return null;
  const d = new Date(`${v}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function num(v: string): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireRole("admin");
  const params = await searchParams;

  const q = fstr(params, "q");
  const party = fstr(params, "party");
  const dateFrom = fstr(params, "dateFrom");
  const dateTo = fstr(params, "dateTo");
  const dueFrom = fstr(params, "dueFrom");
  const dueTo = fstr(params, "dueTo");
  const minPending = fstr(params, "minPending");
  const maxPending = fstr(params, "maxPending");
  const minDays = fstr(params, "minDays");
  const maxDays = fstr(params, "maxDays");
  const route = fstr(params, "route");
  const dept = fstr(params, "dept");
  const sort = fstr(params, "sort") || "overdueDesc";

  // Base: an alert is an OPEN bill (`pendingAmount > 0`) that carries a manual
  // overdue aging (`overdueDays > 0`). Every filter below narrows that set.
  const query: Record<string, unknown> = {
    pendingAmount: { $gt: 0 },
    overdueDays: { $gt: 0 },
  };

  // Overdue-days range. `minDays` replaces the base `$gt: 0` (a positive `$gte`
  // implies it); `maxDays` merges in. Both together form a closed range.
  const overdueDays: Record<string, number> = { $gt: 0 };
  const minD = num(minDays);
  if (minD !== null && minD > 0) overdueDays.$gte = minD;
  const maxD = num(maxDays);
  if (maxD !== null && maxD > 0) overdueDays.$lte = maxD;
  query.overdueDays = overdueDays;

  // Pending range, merged into the open guard so it is never overwritten.
  const pending: Record<string, number> = { $gt: 0 };
  const minP = num(minPending);
  if (minP !== null && minP >= 0) pending.$gte = minP;
  const maxP = num(maxPending);
  if (maxP !== null && maxP >= 0) pending.$lte = maxP;
  query.pendingAmount = pending;

  if (dateFrom || dateTo) {
    const billDate: Record<string, Date> = {};
    const from = dayStart(dateFrom);
    const to = dayEnd(dateTo);
    if (from) billDate.$gte = from;
    if (to) billDate.$lte = to;
    query.billDate = billDate;
  }

  if (dueFrom || dueTo) {
    const dueOn: Record<string, Date> = {};
    const dFrom = dayStart(dueFrom);
    const dTo = dayEnd(dueTo);
    if (dFrom) dueOn.$gte = dFrom;
    if (dTo) dueOn.$lte = dTo;
    query.dueOn = dueOn;
  }

  if (party) query.partyName = party;

  // `route` = where the bill is ROUTED (from its bill number). `dept` = who
  // ENTERED it. Two different questions, two params.
  if (route && route !== "unrouted") {
    query.departments = route;
  }
  if (dept === "unknown") {
    query.createdByRole = { $in: [null, ""] };
  } else if (dept) {
    query.createdByRole = dept;
  }

  // `$or` is a TOP-LEVEL operator — nesting it under a field is a server error.
  // Both `route=unrouted` and `q` can contribute conditions, so they are collected
  // into one array rather than either clobbering the other.
  const orConditions: Record<string, unknown>[] = [];
  if (route === "unrouted") {
    orConditions.push({ departments: { $size: 0 } }, { departments: { $exists: false } });
  }
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    orConditions.push({ partyName: rx }, { billNumber: rx }, { referenceNo: rx });
  }
  if (orConditions.length > 0) query.$or = orConditions;

  const sortSpec = ALERT_SORTS[sort] ?? ALERT_SORTS.overdueDesc;

  const bills = (await PendingBill.find(query)
    .select({
      billNumber: 1,
      referenceNo: 1,
      partyName: 1,
      billDate: 1,
      overdueDays: 1,
      pendingAmount: 1,
      dueOn: 1,
      createdByRole: 1,
      departments: 1,
    })
    .sort(sortSpec)
    .lean()
    .exec()) as unknown as AlertBill[];

  // Filter dropdowns are drawn from the overdue register itself, so an option can
  // never name a party or department that has no overdue bills.
  const [partyOptions, entryDeptOptions] = await Promise.all([
    PendingBill.distinct("partyName", { pendingAmount: { $gt: 0 }, overdueDays: { $gt: 0 } }),
    PendingBill.distinct("createdByRole", {
      pendingAmount: { $gt: 0 },
      overdueDays: { $gt: 0 },
      createdByRole: { $exists: true, $ne: null },
    }),
  ]);

  const totalPending = bills.reduce((s, b) => s + b.pendingAmount, 0);
  const parties = new Set(bills.map((b) => b.partyName)).size;
  const worst = bills.reduce((m, b) => Math.max(m, b.overdueDays), 0);
  const hasUnknownDept = bills.some((b) => !b.createdByRole);

  return (
    <div>
      <PageHeader
        title="Overdue Alerts"
        subtitle={
          bills.length > 0
            ? `${bills.length} overdue bill(s) across ${parties} party(s) · ${formatBDT(totalPending)} pending · worst aging ${worst} days`
            : "No bills are flagged overdue"
        }
      />

      <FilterBar
        clearHref="/admin/alerts"
        hasFilters={hasAnyFilter(params, FILTER_KEYS)}
        search={
          <div className="w-full">
            <FilterLabel label="Search">
              <input
                name="q"
                defaultValue={q}
                placeholder="Party, bill no, ref…"
                className="input-field w-full"
              />
            </FilterLabel>
          </div>
        }
      >
        <FilterLabel label="Party">
          <select name="party" defaultValue={party} className="input-field w-44">
            <option value="">All parties</option>
            {partyOptions
              .filter((p): p is string => !!p)
              .sort()
              .map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
          </select>
        </FilterLabel>
        <FilterLabel label="Bill Date From">
          <input
            type="date"
            name="dateFrom"
            defaultValue={dateFrom}
            className="input-field w-40"
          />
        </FilterLabel>
        <FilterLabel label="Bill Date To">
          <input type="date" name="dateTo" defaultValue={dateTo} className="input-field w-40" />
        </FilterLabel>
        <FilterLabel label="Due On From">
          <input
            type="date"
            name="dueFrom"
            defaultValue={dueFrom}
            className="input-field w-40"
          />
        </FilterLabel>
        <FilterLabel label="Due On To">
          <input type="date" name="dueTo" defaultValue={dueTo} className="input-field w-40" />
        </FilterLabel>
        <FilterLabel label="Min Pending ৳">
          <input
            type="number"
            name="minPending"
            defaultValue={minPending}
            min="0"
            placeholder="0"
            className="input-field w-28"
          />
        </FilterLabel>
        <FilterLabel label="Max Pending ৳">
          <input
            type="number"
            name="maxPending"
            defaultValue={maxPending}
            min="0"
            placeholder="Any"
            className="input-field w-28"
          />
        </FilterLabel>
        <FilterLabel label="Min Overdue Days">
          <input
            type="number"
            name="minDays"
            defaultValue={minDays}
            min="1"
            placeholder="0"
            className="input-field w-28"
          />
        </FilterLabel>
        <FilterLabel label="Max Overdue Days">
          <input
            type="number"
            name="maxDays"
            defaultValue={maxDays}
            min="1"
            placeholder="Any"
            className="input-field w-28"
          />
        </FilterLabel>
        <FilterLabel label="Routed To">
          <select name="route" defaultValue={route} className="input-field w-44">
            <option value="">All departments</option>
            {BILL_ROUTES.flatMap((r) =>
              r.departments.map((d) => (
                <option key={d} value={d}>
                  {ROLE_LABELS[d]}
                </option>
              ))
            )}
            <option value="unrouted">Unrouted (Accounts only)</option>
          </select>
        </FilterLabel>
        <FilterLabel label="Entered by (Dept)">
          <select name="dept" defaultValue={dept} className="input-field w-44">
            <option value="">All departments</option>
            {entryDeptOptions
              .filter((d): d is string => !!d)
              .sort()
              .map((d) => (
                <option key={d} value={d}>
                  {deptLabelFor(d)}
                </option>
              ))}
            {hasUnknownDept ? <option value="unknown">Unknown</option> : null}
          </select>
        </FilterLabel>
        <FilterLabel label="Sort">
          <select name="sort" defaultValue={sort} className="input-field w-44">
            {Object.keys(ALERT_SORTS).map((s) => (
              <option key={s} value={s}>
                {ALERT_SORT_LABELS[s] ?? s}
              </option>
            ))}
          </select>
        </FilterLabel>
      </FilterBar>

      <p className="mb-3 text-sm text-theme-muted">{bills.length} overdue bill(s)</p>

      {bills.length === 0 ? (
        <EmptyState message="No bills match these filters. Alerts appear here when a bill's col G aging is set." />
      ) : (
        <div className="surface-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-dark min-w-[1100px]">
              <thead>
                <tr>
                  <th>Bill</th>
                  <th>Party</th>
                  <th>Bill Date</th>
                  <th className="text-right">Overdue Days</th>
                  <th className="text-right">Pending</th>
                  <th>Due On</th>
                  <th>Entry By</th>
                  <th>Routed To</th>
                </tr>
              </thead>
              <tbody>
                {bills.map((b) => (
                  <tr key={String(b._id)}>
                    <td>
                      <a
                        href={`/admin/pending-bills/${String(b._id)}/edit`}
                        className="font-mono text-xs text-indigo-300 hover:underline"
                      >
                        {b.billNumber || b.referenceNo}
                      </a>
                    </td>
                    <td className="whitespace-nowrap font-medium text-zinc-100">
                      {b.partyName}
                    </td>
                    <td className="whitespace-nowrap">{formatDate(b.billDate)}</td>
                    <td className="text-right">
                      <span
                        className={`pill ${
                          b.overdueDays > 90
                            ? "pill-red"
                            : b.overdueDays > 30
                              ? "pill-amber"
                              : "pill-zinc"
                        }`}
                      >
                        {b.overdueDays} d
                      </span>
                    </td>
                    <td className="text-right font-semibold text-rose-400">
                      {formatBDT(b.pendingAmount)}
                    </td>
                    <td className="whitespace-nowrap">
                      {b.dueOn ? formatDate(b.dueOn) : "—"}
                    </td>
                    <td className="whitespace-nowrap">
                      {b.createdByRole ? (
                        <span className="pill pill-zinc">{deptLabelFor(b.createdByRole)}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="whitespace-nowrap">
                      {b.departments.length ? (
                        <span className="flex flex-wrap gap-1">
                          {b.departments.map((d) => (
                            <span key={d} className="pill pill-indigo">
                              {deptLabelFor(d)}
                            </span>
                          ))}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
