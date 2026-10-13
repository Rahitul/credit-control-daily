import Link from "next/link";
import { hasRole } from "@/lib/auth";
import type { CustomerCreditRow } from "@/lib/credit";
import { formatBDT } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/ui";
import { FilterBar, FilterLabel, fstr, hasAnyFilter, type SearchParams } from "@/components/filters";
import { CustomerRowActions } from "@/components/CustomerRowActions";
import { CustomerImportButton } from "@/components/CustomerImportButton";
import { CUSTOMER_SORTS, listCustomers } from "@/lib/customersList";
import { ENTRY_ROLES } from "@/lib/nav";
import { partyTermDays, toExportQueryString } from "@/lib/pendingBills";
import { CUSTOMER_CATEGORIES, ROLE_LABELS } from "@/lib/types";
import type { SessionUser } from "@/lib/types";
import { Pagination } from "@/components/Pagination";
import { paginate, parsePage } from "@/lib/pagination";

export const dynamic = "force-dynamic";

export async function CustomersView({
  user,
  params,
  home,
}: {
  user: SessionUser;
  params: SearchParams;
  home: string;
}) {
  const q = fstr(params, "q");
  const category = fstr(params, "category");
  const group = fstr(params, "group");
  const status = fstr(params, "status");
  const branch = fstr(params, "branch");
  const approval = fstr(params, "approval");
  const dept = fstr(params, "dept");
  const sort = fstr(params, "sort") || "name";

  // Fetch + filter + sort live in `lib/customersList.ts` so the Excel export
  // downloads exactly what this screen is showing.
  const list = await listCustomers(params, user);
  const all = list.rows;
  const { seesAll, showFinancials, isAdmin, deptOptions, branches, groups } = list;
  const deptLabel = (key: string) =>
    key && key in ROLE_LABELS
      ? ROLE_LABELS[key as keyof typeof ROLE_LABELS]
      : key || "Unknown";
  /**
   * Terms (Days), four-level precedence — resolved by `partyTermDays`, the
   * same helper the Pending Bills Credit Term column uses for its first two
   * levels (that column has no party-derived range: it falls back to each
   * bill's own gap instead):
   * 1. The stored Credit Limit (Days) — a saved single number > 0, which wins
   *    even when a Min/Max override also exists; blank = automatic, and a
   *    stored 0 is display-skipped (falls through) like blank.
   * 2. A hand-saved Min/Max override (`termMinDays` > 0) — pinned to the
   *    database, so a later pending-bill import cannot move it. `termMaxDays`
   *    null/0 = single number; set = the "7–30" spread.
   * 3. Otherwise, the term is derived live from this party's OPEN bills — each
   *    bill's own `billDate → dueOn` gap.
   * 4. Nothing to show → "—".
   */
  const termCell = (r: CustomerCreditRow) => {
    const term = partyTermDays({
      creditLimitDays: r.rawCreditLimitDays,
      termMinDays: r.termMinDays,
      termMaxDays: r.termMaxDays,
      billTermMin: r.billTermMin,
      billTermMax: r.billTermMax,
    });
    if (!term) return "—";
    return term.min === term.max ? `${term.min} d` : `${term.min}–${term.max} d`;
  };
  const canTransfer = hasRole(user, ...ENTRY_ROLES, "admin");
  const pendingCount = list.pendingCount;

  // Slice AFTER the totals above: they keep describing the full filtered set;
  // only the table body shows one page. Out-of-range pages clamp into range.
  const pager = paginate(all, parsePage(fstr(params, "page")));

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle={
          !seesAll
            ? "Customers you entered"
            : showFinancials
              ? "Full credit position per customer"
              : "Customer directory (credit figures restricted)"
        }
        actions={
          <>
            {canTransfer ? (
              <>
                <CustomerImportButton home={home} />
                <Link
                  href={`${home}/customers/export${toExportQueryString(params)}`}
                  className="btn-ghost"
                >
                  Export
                </Link>
              </>
            ) : null}
            {hasRole(user, ...ENTRY_ROLES) ? (
              <Link href={`${home}/customers/new`} className="btn-primary">
                Add Customer
              </Link>
            ) : null}
          </>
        }
      />

      <FilterBar
        clearHref={`${home}/customers`}
        hasFilters={hasAnyFilter(params, [
          "q",
          "category",
          "group",
          "status",
          "branch",
          "approval",
          "dept",
          "sort",
        ])}
        search={
          <div className="w-full">
            <FilterLabel label="Search">
              <input
                name="q"
                defaultValue={q}
                placeholder="Name…"
                className="input-field w-full"
              />
            </FilterLabel>
          </div>
        }
      >
        <FilterLabel label="Category">
          <select name="category" defaultValue={category} className="input-field w-40">
            <option value="">All categories</option>
            {CUSTOMER_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </FilterLabel>
        <FilterLabel label="Group">
          <select name="group" defaultValue={group} className="input-field w-48">
            <option value="">All groups</option>
            {groups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </FilterLabel>
        <FilterLabel label="Status">
          <select name="status" defaultValue={status} className="input-field w-40">
            <option value="">All statuses</option>
            <option value="overdue">Overdue</option>
            <option value="within">Within terms</option>
          </select>
        </FilterLabel>
        <FilterLabel label="Approval">
          <select name="approval" defaultValue={approval} className="input-field w-40">
            <option value="">All approvals</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
          </select>
        </FilterLabel>
        <FilterLabel label="Branch">
          <select name="branch" defaultValue={branch} className="input-field w-40">
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </FilterLabel>
        <FilterLabel label="Entered by (Dept)">
          <select name="dept" defaultValue={dept} className="input-field w-44">
            <option value="">All departments</option>
            {deptOptions.map((d) => (
              <option key={d || "unknown"} value={d || "unknown"}>
                {deptLabel(d)}
              </option>
            ))}
          </select>
        </FilterLabel>
        <FilterLabel label="Sort by">
          <select name="sort" defaultValue={sort} className="input-field w-44">
            {CUSTOMER_SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </FilterLabel>
      </FilterBar>

      <p className="mb-3 text-sm text-zinc-500">
        {all.length} customer(s)
        {pendingCount > 0 ? (
          <span className="ml-2 text-amber-500">
            · {pendingCount} pending approval
          </span>
        ) : null}
      </p>

      {all.length === 0 ? (
        <EmptyState message="No customers found." />
      ) : (
        <div className="surface-card overflow-hidden">
          {/* Fixed-height scroll box: the sticky header pins to its top edge and
              the horizontal scrollbar stays visible at its bottom edge. */}
          <div className="max-h-[70vh] overflow-x-auto">
            <table className="table-dark table-sticky min-w-[1400px]">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>Category</th>
                  <th>Group</th>
                  <th>Branch</th>
                  <th>Entered By</th>
                  <th>Approval</th>
                  {showFinancials && <th className="text-right">Terms (Days)</th>}
                  {showFinancials && <th className="text-right">Total Sales</th>}
                  {showFinancials && <th className="text-right">Collected</th>}
                  {showFinancials && <th className="text-right">Outstanding</th>}
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pager.pageRows.map((r) => (
                  <tr key={r.customerId}>
                    <td className="whitespace-nowrap font-medium text-zinc-100">
                      {r.name}
                      {r.approvalStatus === "pending" && r.createdByName ? (
                        <span className="block text-xs font-normal text-zinc-500">
                          by {r.createdByName}
                        </span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap text-zinc-300">
                      {r.contactPerson || r.contactNumber ? (
                        <>
                          {r.contactPerson ?? "—"}
                          {r.contactNumber ? (
                            <span className="block text-xs text-zinc-500">
                              {r.contactNumber}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="whitespace-nowrap">{r.category ?? "—"}</td>
                    <td className="whitespace-nowrap">{r.group}</td>
                    <td className="whitespace-nowrap">{r.branch ?? "—"}</td>
                    <td className="whitespace-nowrap">
                      <span className="pill pill-indigo">
                        {deptLabel(r.createdByRole ?? "")}
                      </span>
                      {r.createdByName ? (
                        <span className="block text-xs text-zinc-500">
                          {r.createdByName}
                        </span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap">
                      <span
                        className={`pill ${
                          r.approvalStatus === "approved" ? "pill-green" : "pill-amber"
                        }`}
                      >
                        {r.approvalStatus === "approved" ? "Approved" : "Pending"}
                      </span>
                    </td>
                    {showFinancials && (
                      <td className="whitespace-nowrap text-right" title="Credit term in days">
                        {termCell(r)}
                      </td>
                    )}
                    {showFinancials && (
                      <td className="whitespace-nowrap text-right">{formatBDT(r.totalSales)}</td>
                    )}
                    {showFinancials && (
                      <td className="whitespace-nowrap text-right">{formatBDT(r.totalCollected)}</td>
                    )}
                    {showFinancials && (
                      <td
                        className={`whitespace-nowrap text-right font-medium ${
                          r.status === "overdue" ? "text-red-400" : "text-zinc-200"
                        }`}
                      >
                        {formatBDT(r.outstanding)}
                      </td>
                    )}
                    <td className="whitespace-nowrap">
                      {r.hasBillsData ? (
                        <span
                          className={`pill ${
                            r.billsMaxOverdueDays > 0 ? "pill-red" : "pill-green"
                          }`}
                        >
                          {r.billsMaxOverdueDays > 0
                            ? `Overdue ${r.billsMaxOverdueDays}d`
                            : "Within Terms"}
                        </span>
                      ) : r.hasSalesData ? (
                        <span className="text-zinc-500">—</span>
                      ) : (
                        <span className="text-zinc-500">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <CustomerRowActions
                        id={r.customerId}
                        name={r.name}
                        home={home}
                        approvalStatus={r.approvalStatus}
                        approvedByName={r.approvedByName}
                        canApprove={isAdmin}
                        canDelete={isAdmin}
                      />
                    </td>                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            path={`${home}/customers`}
            params={params}
            page={pager.page}
            totalPages={pager.totalPages}
            total={pager.total}
            start={pager.start}
            end={pager.end}
          />
        </div>
      )}
    </div>
  );
}
