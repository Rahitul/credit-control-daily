/**
 * Accounts/Admin "Distribute Work" screen.
 *
 * Two tables — outstanding Sales-routed bills and Sales-routed sales — because
 * they are the two registers a sales user needs restricted. Both list the SAME
 * sales-routed universe, split by allocation state, so the queue of work waiting
 * to be handed out is obvious at a glance.
 *
 * Server Component. It only reads and renders; every write goes through
 * `app/actions/distribute.ts`.
 */

import Link from "next/link";
import { Types } from "mongoose";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { PendingBill } from "@/lib/models/PendingBill";
import { Sale } from "@/lib/models/Sale";
import { User } from "@/lib/models/User";
import { Customer } from "@/lib/models/Customer";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { DistributePanel } from "@/components/DistributePanel";
import type { SearchParams } from "@/components/filters";

export const dynamic = "force-dynamic";

/** Cap per table. A distribution queue beyond this is a report, not a task. */
const CAP = 300;

const HEX24 = /^[0-9a-fA-F]{24}$/;

/**
 * The allocation predicate, as a concrete union rather than a Mongoose filter
 * type: an `unknown`- or `any`-typed `assignedTo` is not assignable to Mongoose's
 * `StrictCondition<ObjectId>`, and it is the spread into `find()` that fails.
 * Naming the three concrete shapes keeps the spread assignable without pinning
 * us to a filter-type name that moves between Mongoose majors.
 */
type AllocationClause =
  | { assignedTo: Types.ObjectId }
  | { $or: [{ assignedTo: null }, { assignedTo: { $exists: false } }] }
  | Record<string, never>;

function fstr(params: SearchParams, key: string): string {
  const v = params[key];
  return typeof v === "string" ? v : "";
}

type BillRow = {
  id: string;
  referenceNo: string;
  billNumber: string;
  partyName: string;
  billDate: string;
  pendingAmount: number;
  overdueDays: number;
  assignedTo: string;
  assigneeName: string;
};

type SaleRow = {
  id: string;
  referenceId: string;
  billNo: string;
  customerName: string;
  saleDate: string;
  amount: number;
  assignedTo: string;
  assigneeName: string;
};

export async function DistributeView({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireRole("accounts", "admin");
  await db();

  const params = await searchParams;
  const tab = fstr(params, "tab") === "sales" ? "sales" : "bills";
  // Three states, resolved up front. A bare `assigned === "all" ? … : unassigned`
  // ternary silently sends a user id down the unassigned branch, which then
  // excludes that person's own rows — and an unrecognised value falls out of both
  // branches entirely, which fails OPEN and shows the whole register. So anything
  // that is neither "all" nor a real id resolves to the unassigned queue.
  const assigned = fstr(params, "assigned") || "unassigned";
  const mode = assigned === "all" ? "all" : HEX24.test(assigned) ? "user" : "unassigned";
  const assigneeId = mode === "user" ? assigned : null;

  /**
   * The allocation predicate for one of the two queries.
   *
   * Generic over the model's own shape so the result is a real `FilterQuery<T>`
   * rather than an untyped bag — an `unknown`-typed `assignedTo` will not
   * satisfy Mongoose's `StrictCondition`, and the spread into `find()` is what
   * fails, not the helper.
   *
   * `$or` must sit at the TOP level of the query — nesting it under a field is a
   * `MongoServerError: unknown operator: $or` — so the "no allocation" shapes
   * (explicit null, and the field absent on pre-migration docs) are spread as a
   * top-level `$or` rather than being folded into the same object.
   */
  const allocationClause = (): AllocationClause =>
    mode === "user"
      ? { assignedTo: new Types.ObjectId(assigneeId as string) }
      : mode === "unassigned"
        ? { $or: [{ assignedTo: null }, { assignedTo: { $exists: false } }] }
        : {};

  const [salesUsers, bills, sales, partyTotal, salesTotal] = await Promise.all([
    User.find({ role: "sales", status: "active" })
      .select({ _id: 1, name: 1, email: 1 })
      .sort({ name: 1 })
      .lean()
      .exec(),
    PendingBill.find({
      departments: "sales",
      pendingAmount: { $gt: 0 },
      ...allocationClause(),
    })
      .sort({ billDate: 1 })
      .limit(CAP)
      .select({
        referenceNo: 1,
        billNumber: 1,
        partyName: 1,
        billDate: 1,
        pendingAmount: 1,
        overdueDays: 1,
        assignedTo: 1,
        customerId: 1,
      })
      .lean()
      .exec(),
    Sale.find({
      departments: "sales",
      ...allocationClause(),
    })
      .sort({ saleDate: 1 })
      .limit(CAP)
      .select({
        referenceId: 1,
        billNo: 1,
        customerId: 1,
        saleDate: 1,
        amount: 1,
        assignedTo: 1,
      })
      .lean()
      .exec(),
    PendingBill.aggregate<{ n: number; total: number }>([
      { $match: { departments: "sales", pendingAmount: { $gt: 0 } } },
      { $group: { _id: null, n: { $sum: 1 }, total: { $sum: "$pendingAmount" } } },
    ]),
    Sale.aggregate<{ n: number; total: number }>([
      { $match: { departments: "sales" } },
      { $group: { _id: null, n: { $sum: 1 }, total: { $sum: "$amount" } } },
    ]),
  ]);

  // One batched name lookup for every assignee id on screen, rather than one
  // query per row.
  const ids = [
    ...new Set(
      [...bills, ...sales]
        .map((r) => (r.assignedTo ? String(r.assignedTo) : ""))
        .filter((v) => /^[0-9a-fA-F]{24}$/.test(v))
    ),
  ];
  const nameById = new Map<string, string>();
  if (ids.length) {
    const users = await User.find({ _id: { $in: ids } })
      .select({ name: 1 })
      .lean()
      .exec();
    for (const u of users) nameById.set(String(u._id), u.name);
  }

  // A lean `Sale` has only `customerId`, so the party name is a second batched
  // join rather than something already on the document.
  const customerIds = [
    ...new Set(
      sales.map((s) => String(s.customerId)).filter((v) => /^[0-9a-fA-F]{24}$/.test(v))
    ),
  ];
  const customerById = new Map<string, string>();
  if (customerIds.length) {
    const customers = await Customer.find({ _id: { $in: customerIds } })
      .select({ name: 1 })
      .lean()
      .exec();
    for (const c of customers) customerById.set(String(c._id), c.name);
  }

  const billRows: BillRow[] = bills.map((b) => ({
    id: String(b._id),
    referenceNo: b.referenceNo,
    billNumber: b.billNumber ?? "",
    partyName: b.partyName,
    billDate: formatDate(b.billDate),
    pendingAmount: b.pendingAmount,
    overdueDays: b.overdueDays ?? 0,
    assignedTo: b.assignedTo ? String(b.assignedTo) : "",
    assigneeName: b.assignedTo ? (nameById.get(String(b.assignedTo)) ?? "") : "",
  }));

  const saleRows: SaleRow[] = sales.map((s) => ({
    id: String(s._id),
    referenceId: s.referenceId,
    billNo: s.billNo ?? "",
    customerName: customerById.get(String(s.customerId)) ?? "—",
    saleDate: formatDate(s.saleDate),
    amount: s.amount,
    assignedTo: s.assignedTo ? String(s.assignedTo) : "",
    assigneeName: s.assignedTo ? (nameById.get(String(s.assignedTo)) ?? "") : "",
  }));

  // `SearchSelect` options are `{ value, label, hint }` — `value` is what gets
  // written to the form, `label`/`hint` are what get shown and searched.
  const users = salesUsers.map((u) => ({
    value: String(u._id),
    label: u.name,
    hint: u.email,
  }));

  const tabHref = (next: "bills" | "sales") => {
    const sp = new URLSearchParams({ tab: next, assigned });
    return `?${sp.toString()}`;
  };

  const billQueue = partyTotal[0]?.n ?? 0;
  const saleQueue = salesTotal[0]?.n ?? 0;

  return (
    <div>
      <PageHeader
        title="Distribute Work"
        subtitle="Hand the sales register to the sales people who will chase it. A sales user sees only what is assigned to them."
        actions={
          <Link href={`/accounts/pending-bills?route=sales`} className="btn-ghost">
            Sales-routed bills
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-2">
          <Link
            href={tabHref("bills")}
            className={tab === "bills" ? "btn-primary" : "btn-ghost"}
          >
            Pending Bills
          </Link>
          <Link
            href={tabHref("sales")}
            className={tab === "sales" ? "btn-primary" : "btn-ghost"}
          >
            Sales
          </Link>
        </div>
        <div className="flex gap-2">
          <Link
            href={`?tab=${tab}&assigned=unassigned`}
            className={mode === "unassigned" ? "btn-primary" : "btn-ghost"}
          >
            Unassigned
          </Link>
          <Link
            href={`?tab=${tab}&assigned=all`}
            className={mode === "all" ? "btn-primary" : "btn-ghost"}
          >
            Everyone
          </Link>
          {users.map((u) => (
            <Link
              key={u.value}
              href={`?tab=${tab}&assigned=${u.value}`}
              className={assigneeId === u.value ? "btn-primary" : "btn-ghost"}
            >
              {u.label}
            </Link>
          ))}
        </div>
      </div>

      {users.length === 0 ? (
        <div className="surface-card p-4 text-sm text-amber-300">
          There are no active users with the Sales role, so there is nobody to
          distribute to. Create one under Users &amp; Roles first.
        </div>
      ) : null}

      {tab === "bills" ? (
        <DistributePanel
          target="bills"
          actionName="assignPendingBills"
          users={users}
          rows={billRows}
          assignedFilter={mode}
          pendingTotal={partyTotal[0]?.total ?? 0}
          pendingCount={billQueue}
          emptyMessage="No sales-routed pending bills match this filter."
        />
      ) : (
        <DistributePanel
          target="sales"
          actionName="assignSales"
          users={users}
          rows={saleRows}
          assignedFilter={mode}
          pendingTotal={salesTotal[0]?.total ?? 0}
          pendingCount={saleQueue}
          emptyMessage="No sales-routed sales match this filter."
        />
      )}
    </div>
  );
}
