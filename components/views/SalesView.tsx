import Link from "next/link";
import { hasRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { Sale } from "@/lib/models/Sale";
import { Customer } from "@/lib/models/Customer";
import { User } from "@/lib/models/User";
import { Branch } from "@/lib/models/Branch";
import { formatBDT, formatDate } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/ui";
import { DEPARTMENT_ROLES, ENTRY_ROLES, isSalesAllocated, primaryRole, salesAssigneeClause, seesAllEntries } from "@/lib/nav";
import {
  FilterBar,
  FilterLabel,
  fstr,
  hasAnyFilter,
  type SearchParams,
} from "@/components/filters";
import { ROLE_LABELS, type Role, type SessionUser } from "@/lib/types";
import { SaleImportButton } from "@/components/SaleImportButton";
import { SaleRowActions } from "@/components/SaleRowActions";
import { Pagination } from "@/components/Pagination";
import { paginate, parsePage } from "@/lib/pagination";

export const dynamic = "force-dynamic";

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

function escapeRegex(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function SalesView({
  user,
  params,
  home,
  department = null,
}: {
  user: SessionUser;
  params: SearchParams;
  home: string;
  department?: Role | null;
}) {
  await db();

  const canSeeAll = seesAllEntries(user.roles);

  const q = fstr(params, "q");
  const customerId = fstr(params, "customerId");
  const dateFrom = fstr(params, "dateFrom");
  const dateTo = fstr(params, "dateTo");
  const minAmount = fstr(params, "minAmount");
  const maxAmount = fstr(params, "maxAmount");
  const entryBy = fstr(params, "entryBy");
  const billNo = fstr(params, "billNo");
  const billDateFrom = fstr(params, "billDateFrom");
  const billDateTo = fstr(params, "billDateTo");
  const dept = fstr(params, "dept");
  const route = fstr(params, "route");
  const branch = fstr(params, "branch");
  const assigned = fstr(params, "assigned");
  const sort = fstr(params, "sort") || "dateDesc";

  // Only the distributors need to see or filter by allocation: a sales user is
  // already restricted to their own rows, so the column would just echo their
  // name back at them.
  const showAssignee = !isSalesAllocated(user.roles);

  const [customers, entryByList, deptList, salesUsers, branchIds] = await Promise.all([
    Customer.find().select({ name: 1 }).sort({ name: 1 }).lean().exec(),
    Sale.distinct("entryBy", { entryBy: { $exists: true, $ne: null } }),
    Sale.distinct("createdByRole", { createdByRole: { $exists: true, $ne: null } }),
    showAssignee
      ? User.find({ role: "sales", status: "active" })
          .select({ _id: 1, name: 1 })
          .sort({ name: 1 })
          .lean()
          .exec()
      : Promise.resolve([]),
    Sale.distinct("branchId", { branchId: { $exists: true, $ne: null } }),
  ]);

  // Branch dropdown options: the branches this register actually references,
  // labelled with each branch's CURRENT name (so a rename relabels the control,
  // while the column keeps the snapshot the sale was written with — the id is the
  // stable key, and grouping by it is correct across a rename). Options come from
  // the whole register, not the filtered rows, so picking one cannot make the
  // others disappear.
  const branchHex = (branchIds as unknown[])
    .map((v) => String(v ?? ""))
    .filter((v) => /^[0-9a-fA-F]{24}$/.test(v));
  const branchDocs = branchHex.length
    ? await Branch.find({ _id: { $in: branchHex } })
        .select({ name: 1 })
        .sort({ name: 1 })
        .lean()
        .exec()
    : [];
  const branchOptions = branchDocs.map((b) => ({ id: String(b._id), name: b.name }));

  const query: Record<string, unknown> = {};
  if (customerId) query.customerId = customerId;
  // Admin/accounts see all sales; department roles see only their own
  if (department) {
    query.departments = department;
    if (department === "sales") {
      const clause = salesAssigneeClause(user.roles, user.id, department);
      if (clause) Object.assign(query, clause);
    }
  } else if (!canSeeAll) {
    query.entryBy = user.name;
  }
  if (user.roles.includes("branches") && user.branchId) {
    query.branchId = user.branchId;
  } else if (branch === "unassigned") {
    query.branchId = null;
  } else if (/^[0-9a-fA-F]{24}$/.test(branch) && !user.roles.includes("branches")) {
    query.branchId = branch;
  }
  if (dept === "unknown") {
    query.createdByRole = { $in: [null, ""] };
  } else if (dept) {
    query.createdByRole = dept;
  }
  if (route === "unrouted") {
    query.departments = { $size: 0 };
  } else if (route) {
    query.departments = route;
  }
  /**
   * `branch` = WHICH BRANCH OFFICE, distinct from `route` (which app the sale is
   * filed in): a `WO/…` reference carrying a branch prefix is routed to both EID
   * and Branches, and this picks out the office. Indexed on `Sale`, so it goes in
   * the query. Hex-guarded so an unrecognised value falls through to "no filter"
   * rather than matching nothing and looking like an empty register; `null` in
   * Mongo also matches absent, collecting pre-branch-routing sales.
   */
  if (branch === "unassigned") {
    query.branchId = null;
  } else if (/^[0-9a-fA-F]{24}$/.test(branch)) {
    query.branchId = branch;
  }
  // Work-allocation filter (Accounts/Admin). `{ assignedTo: null }` in Mongo also
  // matches rows where the field is absent, so pre-allocation sales land in the
  // same "Unassigned" bucket without needing an `$or` that would clash above.
  if (showAssignee) {
    if (assigned === "unassigned") {
      query.assignedTo = null;
    } else if (/^[0-9a-fA-F]{24}$/.test(assigned)) {
      query.assignedTo = assigned;
    }
  }
  if (dateFrom || dateTo) {
    const saleDate: Record<string, Date> = {};
    const from = dayStart(dateFrom);
    const to = dayEnd(dateTo);
    if (from) saleDate.$gte = from;
    if (to) saleDate.$lte = to;
    query.saleDate = saleDate;
  }
  if (minAmount || maxAmount) {
    const amount: Record<string, number> = {};
    if (minAmount) amount.$gte = Number(minAmount);
    if (maxAmount) amount.$lte = Number(maxAmount);
    query.amount = amount;
  }
  if (billNo) {
    query.billNo = { $regex: escapeRegex(billNo), $options: "i" };
  }
  if (billDateFrom || billDateTo) {
    const billDate: Record<string, Date> = {};
    const bFrom = dayStart(billDateFrom);
    const bTo = dayEnd(billDateTo);
    if (bFrom) billDate.$gte = bFrom;
    if (bTo) billDate.$lte = bTo;
    query.billDate = billDate;
  }

  let sales = await Sale.find(query).limit(500).lean().exec();

  // Resolve the entering user from the users collection by `createdBy` ObjectId.
  // Values may be a real ObjectId or a legacy hex string → normalize with String() first;
  // non-hex garbage is dropped so User.find can't throw a CastError. `assignedTo`
  // rides along in the same batch — both resolve against `User`.
  const creatorIds = [
    ...new Set(
      sales
        .flatMap((s) => [s.createdBy, s.assignedTo])
        .map((v) => (v ? String(v) : ""))
        .filter((v) => /^[0-9a-fA-F]{24}$/.test(v))
    ),
  ];
  const creators = creatorIds.length
    ? await User.find({ _id: { $in: creatorIds } })
        .select({ name: 1, role: 1 })
        .lean()
        .exec()
    : [];
  const creatorById = new Map(creators.map((u) => [String(u._id), u]));

  if (q) {
    const needle = q.toLowerCase();
    sales = sales.filter((s) => {
      const creator = s.createdBy ? creatorById.get(String(s.createdBy)) : undefined;
      const assignee = s.assignedTo ? creatorById.get(String(s.assignedTo)) : undefined;
      const hay = [
        s.referenceId,
        s.billNo ?? "",
        s.entryBy ?? "",
        creator?.name ?? "",
        assignee?.name ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }

  const sortMap: Record<string, Record<string, 1 | -1>> = {
    dateDesc: { saleDate: -1, createdAt: -1 },
    dateAsc: { saleDate: 1, createdAt: 1 },
    amountDesc: { amount: -1 },
    amountAsc: { amount: 1 },
    refDesc: { referenceId: -1 },
    refAsc: { referenceId: 1 },
    billNoDesc: { billNo: -1, saleDate: -1 },
    billNoAsc: { billNo: 1, saleDate: -1 },
  };
  const sortSpec = sortMap[sort] ?? sortMap.dateDesc;
  sales = [...sales].sort((a, b) => {
    for (const [key, dir] of Object.entries(sortSpec)) {
      const av = a[key as keyof typeof a];
      const bv = b[key as keyof typeof b];
      let cmp = 0;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av ?? "").localeCompare(String(bv ?? ""));
      if (cmp !== 0) return dir === 1 ? cmp : -cmp;
    }
    return 0;
  });

  const custMap = new Map(customers.map((c) => [String(c._id), c.name]));
  const total = sales.reduce((s, x) => s + x.amount, 0);
  const entryOptions = [...entryByList].filter((v): v is string => !!v).sort();
  const deptOptions = [...deptList].filter((v): v is string => !!v).sort();
  const deptLabel = (key: string) =>
    key && key in ROLE_LABELS
      ? ROLE_LABELS[key as keyof typeof ROLE_LABELS]
      : key || "Unknown";
  const creatorFor = (s: (typeof sales)[number]) =>
    s.createdBy ? creatorById.get(String(s.createdBy)) : undefined;
  const roleOf = (s: (typeof sales)[number]) => {
    const creator = creatorFor(s);
    return s.createdByRole ?? (creator ? primaryRole(creator.role) : "");
  };
  const hasUnknownDept = sales.some((s) => !s.createdByRole);
  const unassignedCount = sales.filter((s) => !s.assignedTo).length;

  // Slice AFTER the totals above: they keep describing the full filtered set;
  // only the table body shows one page. Out-of-range pages clamp into range.
  const pager = paginate(sales, parsePage(fstr(params, "page")));

  return (
    <div>
      <PageHeader
        title="Sales"
        subtitle={
          canSeeAll
            ? "Every sale increases the customer's outstanding balance"
            : "Your sales entries only"
        }
        actions={
          <>
            {hasRole(user, ...ENTRY_ROLES) ? (
              <Link href={`${home}/sales/new`} className="btn-primary">
                New Sale
              </Link>
            ) : null}
            <Link href={`${home}/sales/export`} className="btn-ghost">
              Export
            </Link>
            <SaleImportButton home={home} />
          </>
        }
      />

      <FilterBar
        clearHref={`${home}/sales`}
        hasFilters={hasAnyFilter(params, [
          "q",
          "customerId",
          "dateFrom",
          "dateTo",
          "minAmount",
          "maxAmount",
          "entryBy",
          "billNo",
          "billDateFrom",
          "billDateTo",
          "dept",
          "route",
          "branch",
          "assigned",
          "sort",
        ])}
        search={
          <div className="w-full">
            <FilterLabel label="Search">
              <input
                name="q"
                defaultValue={q}
                placeholder="Ref, bill no, description…"
                className="input-field w-full"
              />
            </FilterLabel>
          </div>
        }
      >
        <FilterLabel label="Customer">
          <select name="customerId" defaultValue={customerId} className="input-field w-48">
            <option value="">All customers</option>
            {customers.map((c) => (
              <option key={String(c._id)} value={String(c._id)}>
                {c.name}
              </option>
            ))}
          </select>
        </FilterLabel>
        <FilterLabel label="From">
          <input
            type="date"
            name="dateFrom"
            defaultValue={dateFrom}
            className="input-field w-40"
          />
        </FilterLabel>
        <FilterLabel label="To">
          <input
            type="date"
            name="dateTo"
            defaultValue={dateTo}
            className="input-field w-40"
          />
        </FilterLabel>
        <FilterLabel label="Min ৳">
          <input
            type="number"
            name="minAmount"
            defaultValue={minAmount}
            min="0"
            placeholder="0"
            className="input-field w-28"
          />
        </FilterLabel>
        <FilterLabel label="Max ৳">
          <input
            type="number"
            name="maxAmount"
            defaultValue={maxAmount}
            min="0"
            placeholder="Any"
            className="input-field w-28"
          />
        </FilterLabel>
        {canSeeAll ? (
          <FilterLabel label="Entry by">
            <select name="entryBy" defaultValue={entryBy} className="input-field w-40">
              <option value="">Anyone</option>
              {entryOptions.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </FilterLabel>
        ) : null}
        <FilterLabel label="Entered by (Dept)">
          <select name="dept" defaultValue={dept} className="input-field w-44">
            <option value="">All departments</option>
            {deptOptions.map((d) => (
              <option key={d} value={d}>
                {deptLabel(d)}
              </option>
            ))}
            {hasUnknownDept ? <option value="unknown">Unknown</option> : null}
          </select>
        </FilterLabel>
        {showAssignee ? (
          <FilterLabel label="Assigned To">
            <select name="assigned" defaultValue={assigned} className="input-field w-44">
              <option value="">Anyone</option>
              <option value="unassigned">Unassigned</option>
              {salesUsers.map((u) => (
                <option key={String(u._id)} value={String(u._id)}>
                  {u.name}
                </option>
              ))}
            </select>
          </FilterLabel>
        ) : null}
        {!department && (
          <FilterLabel label="Routed To">
            <select name="route" defaultValue={route} className="input-field w-44">
              <option value="">All departments</option>
              {/* Driven by DEPARTMENT_ROLES, not BILL_ROUTES: `branches` is a real
                  routing target but has NO BILL_ROUTES entry (it routes on a branch
                  prefix, not a bill-number prefix), so reading options off
                  BILL_ROUTES would omit it. Same list the apps are scoped by, so the
                  dropdown cannot drift from what is routable. */}
              {DEPARTMENT_ROLES.map((d) => (
                <option key={d} value={d}>
                  {ROLE_LABELS[d]}
                </option>
              ))}
              <option value="unrouted">Unrouted (Accounts only)</option>
            </select>
          </FilterLabel>
        )}
        <FilterLabel label="Branch">
          <select name="branch" defaultValue={branch} className="input-field w-44" disabled={!!user.roles.includes("branches")}>
            <option value="">All branches</option>
            {branchOptions.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
            <option value="unassigned">No branch</option>
          </select>
        </FilterLabel>
        <FilterLabel label="Bill No">
          <input
            name="billNo"
            defaultValue={billNo}
            placeholder="Any bill"
            className="input-field w-40"
          />
        </FilterLabel>
        <FilterLabel label="Bill Date From">
          <input
            type="date"
            name="billDateFrom"
            defaultValue={billDateFrom}
            className="input-field w-40"
          />
        </FilterLabel>
        <FilterLabel label="Bill Date To">
          <input
            type="date"
            name="billDateTo"
            defaultValue={billDateTo}
            className="input-field w-40"
          />
        </FilterLabel>
        <FilterLabel label="Sort">
          <select name="sort" defaultValue={sort} className="input-field w-44">
            <option value="dateDesc">Date (new)</option>
            <option value="dateAsc">Date (old)</option>
            <option value="amountDesc">Amount high</option>
            <option value="amountAsc">Amount low</option>
            <option value="refDesc">Ref Z–A</option>
            <option value="refAsc">Ref A–Z</option>
            <option value="billNoDesc">Bill No Z–A</option>
            <option value="billNoAsc">Bill No A–Z</option>
          </select>
        </FilterLabel>
      </FilterBar>

      <p className="mb-3 text-sm text-zinc-500">
        {sales.length} sales · Total{" "}
        <span className="font-medium text-zinc-200">{formatBDT(total)}</span>
        {showAssignee && unassignedCount > 0 ? (
          <>
            {" · "}
            <Link
              href={`${home}/sales?assigned=unassigned`}
              className="font-medium text-indigo-300 hover:underline"
            >
              {unassignedCount} unassigned
            </Link>
          </>
        ) : null}
      </p>

      {sales.length === 0 ? (
        <EmptyState
          message={
            isSalesAllocated(user.roles)
              ? "No sales have been assigned to you yet. Accounts or Admin distribute the sales register to you, and the sales you are responsible for appear here."
              : "No sales found."
          }
        />
      ) : (
        <div className="surface-card overflow-hidden">
          {/* Fixed-height scroll box: the sticky header pins to its top edge and
              the horizontal scrollbar stays visible at its bottom edge. */}
          <div className="max-h-[70vh] overflow-x-auto">
            <table className="table-dark table-sticky min-w-[1200px]">
              <thead>
                <tr>
                  <th>Reference ID</th>
                  <th>Bill No</th>
                  <th>Bill Date</th>
                  <th>Date</th>
                  <th>Customer</th>
                  {!department && <th>Routed To</th>}
                  <th>Branch</th>
                  <th className="text-right">Amount</th>
                  <th>Entry By</th>
                  {showAssignee ? <th>Assigned To</th> : null}
                  <th />
                </tr>
              </thead>
              <tbody>
                {pager.pageRows.map((s) => {
                  const creator = creatorFor(s);
                  const role = roleOf(s);
                  return (
                    <tr key={String(s._id)}>
                      <td className="whitespace-nowrap font-mono text-xs text-indigo-300">
                        {s.referenceId}
                      </td>
                      <td className="whitespace-nowrap font-mono text-xs text-zinc-300">
                        {s.billNo ?? "—"}
                      </td>
                      <td className="whitespace-nowrap">
                        {s.billDate ? formatDate(s.billDate) : "—"}
                      </td>
                      <td className="whitespace-nowrap">{formatDate(s.saleDate)}</td>
                      <td className="whitespace-nowrap font-medium text-zinc-100">
                        {custMap.get(String(s.customerId)) ?? "—"}
                      </td>
                      {!department && (
                        <td className="whitespace-nowrap">
                          {s.departments?.length ? (
                            <span className="flex flex-wrap gap-1">
                              {s.departments.map((d) => (
                                <span key={d} className="pill pill-indigo">
                                  {ROLE_LABELS[d]}
                                </span>
                              ))}
                            </span>
                          ) : (
                            <span className="pill pill-amber">Accounts only</span>
                          )}
                        </td>
                      )}
                      {/* The branch office, as the WRITE-TIME snapshot of
                          `Branch.name`. "—" on sales entered before branch routing
                          existed; the column above is the department, a different
                          question. */}
                      <td className="whitespace-nowrap">
                        {s.branchName ? (
                          <span className="pill pill-indigo">{s.branchName}</span>
                        ) : (
                          <span className="text-zinc-500">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-right font-medium text-zinc-100">
                        {formatBDT(s.amount)}
                      </td>
                      <td className="whitespace-nowrap">
                        {creator || s.entryBy ? (
                          <>
                            {creator ? (
                              <span className="pill pill-indigo">
                                {deptLabel(role)}
                              </span>
                            ) : (
                              <span className="pill pill-zinc">
                                {deptLabel(role)}
                              </span>
                            )}
                            <span className="block text-xs text-zinc-500">
                              {creator?.name ?? s.entryBy}
                            </span>
                          </>
                        ) : (
                          <span className="text-zinc-500">—</span>
                        )}
                       </td>
                      {showAssignee ? (
                        <td className="whitespace-nowrap">
                          {(() => {
                            const assignee = s.assignedTo
                              ? creatorById.get(String(s.assignedTo))
                              : undefined;
                            return assignee ? (
                              <span className="text-xs text-zinc-200">{assignee.name}</span>
                            ) : (
                              <span className="pill pill-amber">Unassigned</span>
                            );
                          })()}
                        </td>
                      ) : null}
                      <td>
                        <SaleRowActions
                          id={String(s._id)}
                          referenceId={s.referenceId}
                          home={home}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            path={`${home}/sales`}
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
