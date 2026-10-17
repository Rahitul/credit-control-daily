import Link from "next/link";
import { hasRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { Payment } from "@/lib/models/Payment";
import { Customer } from "@/lib/models/Customer";
import { User } from "@/lib/models/User";
import { formatBDT, formatDate } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/ui";
import { PaymentApproveButton } from "@/components/PaymentApproveButton";
import { PaymentRejectButton } from "@/components/PaymentRejectButton";
import {
  FilterBar,
  FilterLabel,
  fstr,
  hasAnyFilter,
  type SearchParams,
} from "@/components/filters";
import { ENTRY_ROLES, PAYMENT_APPROVER_ROLES, primaryRole, seesAllEntries } from "@/lib/nav";
import { BANK_TYPES, PAYMENT_TYPES, ROLE_LABELS } from "@/lib/types";
import type { Role, SessionUser } from "@/lib/types";
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

export async function PaymentsView({
  user,
  params,
  home,
  department = null,
}: {
  user: SessionUser;
  params: SearchParams;
  home: string;
  /**
   * The department app this URL belongs to. Payments have no `departments`
   * routing field, so a department scope filters on `createdByRole` — the
   * entry-time snapshot of who typed the payment. `null` (Accounts/Admin, and
   * every existing department page until now) keeps the original behaviour:
   * accounts/admin see everything, everyone else sees their own entries.
   */
  department?: Role | null;
}) {
  // admin + accounts see every payment; other roles only their own entries
  const canSeeAll = seesAllEntries(user.roles);

  await db();

  const q = fstr(params, "q");
  const customerId = fstr(params, "customerId");
  const paymentType = fstr(params, "paymentType");
  const bankType = fstr(params, "bankType");
  const dateFrom = fstr(params, "dateFrom");
  const dateTo = fstr(params, "dateTo");
  const minAmount = fstr(params, "minAmount");
  const maxAmount = fstr(params, "maxAmount");
  const branch = fstr(params, "branch");
  const entryBy = fstr(params, "entryBy");
  const assignedPerson = fstr(params, "assignedPerson");
  const dept = fstr(params, "dept");
  // empty = everything, `yes` = discounted only, `no` = non-discounted only
  const discounted = fstr(params, "discounted");
  const vat = fstr(params, "vat");
  const taxAit = fstr(params, "taxAit");
  const sort = fstr(params, "sort") || "dateDesc";
  // `pending` / `approved` / `allocating` / empty for "everything".
  const status = fstr(params, "status");
  const canApprove = hasRole(user, ...PAYMENT_APPROVER_ROLES);

  const customers = await Customer.find()
    .select({ name: 1, branch: 1 })
    .sort({ name: 1 })
    .lean()
    .exec();
  const custMap = new Map(customers.map((c) => [String(c._id), c]));

  const [entryByList, assignedList, branchList, deptList] = await Promise.all([
    Payment.distinct("entryBy", { entryBy: { $exists: true, $ne: null } }),
    Payment.distinct("assignedPerson", { assignedPerson: { $exists: true, $ne: null } }),
    Payment.distinct("branch", { branch: { $exists: true, $ne: null } }),
    Payment.distinct("createdByRole", { createdByRole: { $exists: true, $ne: null } }),
  ]);

  const query: Record<string, unknown> = {};
  if (department) query.createdByRole = department;
  else if (!canSeeAll) query.entryBy = user.name;
  if (status) query.approvalStatus = status;
  if (customerId) query.customerId = customerId;
  if (paymentType) query.paymentType = paymentType;
  // `$ne: true` so legacy rows (field absent) count as non-discounted.
  if (discounted === "yes") query.isDiscounted = true;
  else if (discounted === "no") query.isDiscounted = { $ne: true };
  if (vat === "yes") query.isVat = true;
  else if (vat === "no") query.isVat = { $ne: true };
  if (taxAit === "yes") query.isTaxAit = true;
  else if (taxAit === "no") query.isTaxAit = { $ne: true };
  if (bankType) {
    query.$or = [{ bankType }, { bankName: bankType }];
  }
  if (branch) query.branch = branch;
  if (entryBy && canSeeAll) query.entryBy = entryBy;
  if (assignedPerson) query.assignedPerson = assignedPerson;
  // A pinned department page is already one department's register — the `dept`
  // param must not widen or replace that scope (it is only a filter on the
  // unscoped views, whose select is hidden when `department` is set).
  if (!department) {
    if (dept === "unknown") {
      query.createdByRole = { $in: [null, ""] };
    } else if (dept) {
      query.createdByRole = dept;
    }
  }
  if (dateFrom || dateTo) {
    const rcvDate: Record<string, Date> = {};
    const from = dayStart(dateFrom);
    const to = dayEnd(dateTo);
    if (from) rcvDate.$gte = from;
    if (to) rcvDate.$lte = to;
    query.rcvDate = rcvDate;
  }
  if (minAmount || maxAmount) {
    const rcvAmount: Record<string, number> = {};
    if (minAmount) rcvAmount.$gte = Number(minAmount);
    if (maxAmount) rcvAmount.$lte = Number(maxAmount);
    query.rcvAmount = rcvAmount;
  }

  let payments = await Payment.find(query).limit(500).lean().exec();

  // Resolve the entering user from the users collection by `createdBy` ObjectId.
  // Values may be a real ObjectId or a legacy hex string → normalize with String() first;
  // non-hex garbage is dropped so User.find can't throw a CastError.
  const creatorIds = [
    ...new Set(
      payments
        .map((p) => (p.createdBy ? String(p.createdBy) : ""))
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
    payments = payments.filter((p) => {
      const c = custMap.get(String(p.customerId));
      const creator = p.createdBy ? creatorById.get(String(p.createdBy)) : undefined;
      const hay = [
        c?.name ?? "",
        p.billNo ?? "",
        p.paymentType,
        p.entryBy ?? "",
        creator?.name ?? "",
        p.assignedPerson ?? "",
        p.branch ?? c?.branch ?? "",
        p.relatedSaleReferenceId ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }

  const sortMap: Record<string, Record<string, 1 | -1>> = {
    dateDesc: { rcvDate: -1, createdAt: -1 },
    dateAsc: { rcvDate: 1, createdAt: 1 },
    amountDesc: { rcvAmount: -1 },
    amountAsc: { rcvAmount: 1 },
  };
  const sortSpec = sortMap[sort] ?? sortMap.dateDesc;
  payments = [...payments].sort((a, b) => {
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

  // Two different numbers, deliberately not one. `approvedTotal` is real money
  // that has been released against bills; `pendingTotal` is only claimed. Summing
  // them into a single "Total" would let an unreleased payment read as collected.
  const approvedPayments = payments.filter((p) => p.approvalStatus === "approved");
  const pendingPayments = payments.filter((p) => p.approvalStatus !== "approved");
  const approvedTotal = approvedPayments.reduce((s, p) => s + p.rcvAmount, 0);
  const pendingTotal = pendingPayments.reduce((s, p) => s + p.rcvAmount, 0);
  const entryOptions = [...entryByList].filter((v): v is string => !!v).sort();
  const assignedOptions = [...assignedList].filter((v): v is string => !!v).sort();
  const branchOptions = [...branchList].filter((v): v is string => !!v).sort();
  const deptOptions = [...deptList].filter((v): v is string => !!v).sort();
  const deptLabel = (key: string) =>
    key && key in ROLE_LABELS
      ? ROLE_LABELS[key as keyof typeof ROLE_LABELS]
      : key || "Unknown";
  const creatorFor = (p: (typeof payments)[number]) =>
    p.createdBy ? creatorById.get(String(p.createdBy)) : undefined;
  const roleOf = (p: (typeof payments)[number]) => {
    const creator = creatorFor(p);
    return p.createdByRole ?? (creator ? primaryRole(creator.role) : "");
  };
  const hasUnknownDept = payments.some((p) => !p.createdByRole);

  // Slice AFTER the totals above: they keep describing the full filtered set;
  // only the table body shows one page. Out-of-range pages clamp into range.
  const pager = paginate(payments, parsePage(fstr(params, "page")));

  return (
    <div>
      <PageHeader
        title="Payment History"
        subtitle={
          department
            ? `Payments entered from the ${ROLE_LABELS[department]} app`
            : canSeeAll
              ? "All collection records across departments"
              : "Your submitted payment entries"
        }
        actions={
          hasRole(user, ...ENTRY_ROLES) ? (
            <Link href={`${home}/payments/new`} className="btn-primary">
              New Payment
            </Link>
          ) : null
        }
      />

      <FilterBar
        clearHref={`${home}/payments`}
        hasFilters={hasAnyFilter(params, [
          "q",
          "customerId",
          "paymentType",
          "bankType",
          "dateFrom",
          "dateTo",
          "minAmount",
          "maxAmount",
          "branch",
          "entryBy",
          "assignedPerson",
          "dept",
          "status",
          "discounted",
          "vat",
          "taxAit",
          "sort",
        ])}
        search={
          <div className="w-full">
            <FilterLabel label="Search">
              <input
                name="q"
                defaultValue={q}
                placeholder="Customer, bill, ref…"
                className="input-field w-full"
              />
            </FilterLabel>
          </div>
        }
      >
        <FilterLabel label="Status">
          <select name="status" defaultValue={status} className="input-field w-40">
            <option value="">All statuses</option>
            <option value="pending">Pending approval</option>
            <option value="approved">Approved</option>
            <option value="allocating">Approving…</option>
          </select>
        </FilterLabel>
        <FilterLabel label="Customer">
          <select name="customerId" defaultValue={customerId} className="input-field w-44">
            <option value="">All customers</option>
            {customers.map((c) => (
              <option key={String(c._id)} value={String(c._id)}>
                {c.name}
              </option>
            ))}
          </select>
        </FilterLabel>
        <FilterLabel label="Type">
          <select name="paymentType" defaultValue={paymentType} className="input-field w-36">
            <option value="">All types</option>
            {PAYMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </FilterLabel>
        <FilterLabel label="Discounted">
          <select name="discounted" defaultValue={discounted} className="input-field w-36">
            <option value="">All</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </FilterLabel>
        <FilterLabel label="Vat">
          <select name="vat" defaultValue={vat} className="input-field w-36">
            <option value="">All</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </FilterLabel>
        <FilterLabel label="Tax/AIT">
          <select name="taxAit" defaultValue={taxAit} className="input-field w-36">
            <option value="">All</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </FilterLabel>
        <FilterLabel label="Bank">
          <select name="bankType" defaultValue={bankType} className="input-field w-36">
            <option value="">All banks</option>
            {BANK_TYPES.map((b) => (
              <option key={b} value={b}>
                {b}
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
        <FilterLabel label="Branch">
          <select name="branch" defaultValue={branch} className="input-field w-36">
            <option value="">All</option>
            {branchOptions.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </FilterLabel>
        {canSeeAll ? (
          <FilterLabel label="Entry by">
            <select name="entryBy" defaultValue={entryBy} className="input-field w-36">
              <option value="">Anyone</option>
              {entryOptions.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </FilterLabel>
        ) : null}
        <FilterLabel label="Assigned">
          <select
            name="assignedPerson"
            defaultValue={assignedPerson}
            className="input-field w-36"
          >
            <option value="">Anyone</option>
            {assignedOptions.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </FilterLabel>
        {department ? null : (
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
        )}
        <FilterLabel label="Sort">
          <select name="sort" defaultValue={sort} className="input-field w-40">
            <option value="dateDesc">Date (new)</option>
            <option value="dateAsc">Date (old)</option>
            <option value="amountDesc">Amount high</option>
            <option value="amountAsc">Amount low</option>
          </select>
        </FilterLabel>
      </FilterBar>

      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-500">
        <span>
          {payments.length} entries · Approved{" "}
          <span className="font-medium text-zinc-200">{formatBDT(approvedTotal)}</span>
        </span>
        {pendingPayments.length > 0 ? (
          <span>
            · Awaiting approval{" "}
            <span className="font-medium text-amber-300">
              {formatBDT(pendingTotal)} ({pendingPayments.length})
            </span>
          </span>
        ) : null}
        {canApprove && pendingPayments.length > 0 ? (
          <Link
            href={`${home}/payments?status=pending`}
            className="text-xs text-amber-300 underline underline-offset-2 hover:text-amber-200"
          >
            Review the queue
          </Link>
        ) : null}
      </div>

      {payments.length === 0 ? (
        <EmptyState message="No payment entries found." />
      ) : (
        <div className="surface-card overflow-hidden">
          {/* Fixed-height scroll box: the sticky header pins to its top edge and
              the horizontal scrollbar stays visible at its bottom edge. */}
          <div className="max-h-[70vh] overflow-x-auto">
            <table className="table-dark table-sticky min-w-[1500px]">
              <thead>
                <tr>
                  <th>Rcv Date</th>
                  <th>Customer</th>
                  <th>Branch</th>
                  <th>Bill</th>
                  <th>Type</th>
                  <th>Discounted</th>
                  <th>Vat</th>
                  <th>Tax/AIT</th>
                  <th className="text-right">Amount</th>
                  <th>Bank</th>
                  <th>Assigned</th>
                  <th>Entry By</th>
                  <th>Remarks</th>
                  <th>Status</th>
                  {canApprove ? <th className="text-right">Action</th> : null}
                </tr>
              </thead>
              <tbody>
                {pager.pageRows.map((p) => {
                  const c = custMap.get(String(p.customerId));
                  const creator = creatorFor(p);
                  const role = roleOf(p);
                  return (
                    <tr key={String(p._id)}>
                      <td className="whitespace-nowrap">{formatDate(p.rcvDate)}</td>
                      <td className="whitespace-nowrap font-medium text-zinc-100">
                        {c?.name ?? "—"}
                      </td>
                      <td className="whitespace-nowrap">{p.branch ?? c?.branch ?? "—"}</td>
                      <td className="whitespace-nowrap">
                        {p.billNo ? (
                          <span className="font-mono text-xs">
                            {p.billCategory ? `${p.billCategory} ` : ""}
                            {p.billNo}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="whitespace-nowrap">
                        <span className="pill pill-indigo">{p.paymentType}</span>
                      </td>
                      <td className="whitespace-nowrap">
                        {p.isDiscounted ? (
                          <span className="pill pill-amber">Yes</span>
                        ) : (
                          <span className="pill pill-zinc">No</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap">
                        {p.isVat ? (
                          <span className="pill pill-amber">Yes</span>
                        ) : (
                          <span className="pill pill-zinc">No</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap">
                        {p.isTaxAit ? (
                          <span className="pill pill-amber">Yes</span>
                        ) : (
                          <span className="pill pill-zinc">No</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-right font-medium text-zinc-100">
                        {formatBDT(p.rcvAmount)}
                      </td>
                      <td className="whitespace-nowrap">{p.bankType ?? p.bankName ?? "—"}</td>
                      <td className="whitespace-nowrap">{p.assignedPerson ?? "—"}</td>
                      <td className="whitespace-nowrap">
                        {creator || p.entryBy ? (
                          <>
                            <span
                              className={`pill ${creator ? "pill-indigo" : "pill-zinc"}`}
                            >
                              {deptLabel(role)}
                            </span>
                            <span className="block text-xs text-zinc-500">
                              {creator?.name ?? p.entryBy}
                            </span>
                          </>
                        ) : (
                          <span className="text-zinc-500">—</span>
                        )}
                      </td>
                      <td className="max-w-[220px] whitespace-normal">
                        {p.remarks ?? "—"}
                      </td>
                      <td className="whitespace-nowrap">
                        {p.approvalStatus === "approved" ? (
                          <span className="pill pill-green">Approved</span>
                        ) : p.approvalStatus === "allocating" ? (
                          <span className="pill pill-amber">Approving…</span>
                        ) : (
                          <span className="pill pill-amber">Pending</span>
                        )}
                        {p.approvalStatus === "approved" && p.unallocatedAmount ? (
                          <span
                            className="block text-xs text-amber-300"
                            title="Matched no outstanding bill at approval time"
                          >
                            ৳{p.unallocatedAmount} unallocated
                          </span>
                        ) : null}
                      </td>
                      {canApprove ? (
                        <td className="whitespace-nowrap text-right">
                          <div className="flex items-start justify-end gap-2">
                            {/* Reject = hard delete, PENDING rows only. The
                                server action re-checks both the role and the
                                status, so the button disappearing here is a
                                convenience, not the control. */}
                            <PaymentRejectButton
                              paymentId={String(p._id)}
                              status={p.approvalStatus ?? "pending"}
                              canReject={p.approvalStatus === "pending"}
                            />
                            <PaymentApproveButton
                              paymentId={String(p._id)}
                              status={p.approvalStatus ?? "pending"}
                              // Self-approval is refused server-side; hide the button
                              // too so the queue does not offer an action that fails.
                              canApprove={
                                p.approvalStatus !== "approved" &&
                                !(
                                  (p.createdBy && String(p.createdBy) === user.id) ||
                                  (!p.createdBy && p.entryBy === user.name)
                                )
                              }
                            />
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            path={`${home}/payments`}
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
