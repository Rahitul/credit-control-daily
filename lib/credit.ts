import { Customer } from "@/lib/models/Customer";
import { Payment } from "@/lib/models/Payment";
import { PendingBill } from "@/lib/models/PendingBill";
import { Sale } from "@/lib/models/Sale";
import { User } from "@/lib/models/User";
import { db } from "@/lib/db";
import { primaryRole } from "@/lib/nav";
import { creditTermDays, escapeRegex } from "@/lib/pendingBills";
import type { Role } from "@/lib/types";
import type { Types } from "mongoose";

export type CreditStatus = "within" | "overdue";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Credit limit is a PAYMENT TERM in days:
 * each sale must be fully paid within `creditLimitDays` days of the sale date.
 * A customer is overdue when any sale still has an unpaid balance past its due date.
 */
/**
 * When a sale's balance is due: sale date + payment term.
 * Single source of truth for the term arithmetic (isPastDue / daysOverdue / dueDate).
 */
export function dueDate(saleDate: Date, creditLimitDays: number): Date {
  return new Date(new Date(saleDate).getTime() + creditLimitDays * DAY_MS);
}

export function isPastDue(saleDate: Date, creditLimitDays: number, now = new Date()): boolean {
  return now.getTime() > dueDate(saleDate, creditLimitDays).getTime();
}

export function daysOverdue(saleDate: Date, creditLimitDays: number, now = new Date()): number {
  const due = dueDate(saleDate, creditLimitDays).getTime();
  if (now.getTime() <= due) return 0;
  return Math.floor((now.getTime() - due) / DAY_MS);
}

type AllocSale = {
  amount: number;
  remaining: number;
  saleDate: Date;
  referenceId?: string;
};

/** FIFO: total payments clear the oldest sales first. Returns sales with remaining balances. */
export function allocatePayments(
  sales: { amount: number; saleDate: Date; referenceId?: string }[],
  payments: { amount: number }[]
): AllocSale[] {
  const open: AllocSale[] = [...sales]
    .sort((a, b) => new Date(a.saleDate).getTime() - new Date(b.saleDate).getTime())
    .map((s) => ({ ...s, remaining: s.amount }));

  let available = payments.reduce((s, p) => s + p.amount, 0);
  for (const sale of open) {
    const apply = Math.min(sale.remaining, available);
    sale.remaining -= apply;
    available -= apply;
  }
  return open;
}

export type CustomerCreditRow = {
  customerId: string;
  name: string;
  address?: string;
  contactPerson?: string;
  contactNumber?: string;
  category?: string;
  group: string;
  branch?: string;
  creditLimitDays: number;
  /**
   * The customer's STORED Credit Limit (Days) exactly as saved — `null` when
   * the box was left blank (automatic). `creditLimitDays` above keeps its
   * `?? 30` fallback for the sales-overdue maths and the dashboards/chat that
   * read it; this raw field is what the Customers-list term cell resolves the
   * display precedence with (stored term → Min/Max override → derived range).
   */
  rawCreditLimitDays: number | null;
  totalSales: number;
  totalCollected: number;
  /**
   * Open amount on this party's PendingBills register (sum of `pendingAmount`).
   *
   * This is the authoritative "what do they owe" figure and is the ONLY input to
   * `outstanding` — the sales register is never added to it.
   *
   * The bills register — not `Sale` — is where money is actually collected:
   * `allocatePayment` is the only thing that ever reduces `pendingAmount`, so
   * this figure is already net of every approved payment. Most of the real
   * receivable lives here, and many parties have bills with NO sale at all, so
   * anything that wants "what do they owe" must read this.
   */
  billsOutstanding: number;
  /**
   * Sales + pending-bill **openings** — context for how much was ever billed.
   * Deliberately NOT used for `outstanding`; see that field.
   */
  totalBilled: number;
  /**
   * Unpaid balance on the SALES register only (sale amounts less approved
   * payments, applied FIFO). Reported so sale balances are *visible* without
   * ever being folded into `outstanding` — adding the two would double-count
   * the relationship the bills register already represents.
   */
  salesOutstanding: number;
  saleCount: number;
  /** Open (`pendingAmount > 0`) pending bills for this party. */
  billCount: number;
  /**
   * Unpaid amount on the BILLS register — the same figure the Pending Bills list
   * totals, and the same one that drops to 0 and transfers a row to Completed Bills.
   *
   * The SALES register is deliberately excluded. Both registers describe the same
   * customer-money relationship, so adding sale balances on top double-counts it
   * and makes this column disagree with the bills pages. Sales still drive
   * `totalSales` and the overdue/credit-term view (`overdueAmount`, `status`), and
   * `totalCollected` still counts approved payments, so the row keeps both pictures
   * without conflating them.
   */
  outstanding: number;
  status: CreditStatus;
  /** Unpaid amount on sales that are past their payment-term due date */
  overdueAmount: number;
  /** Worst (largest) number of days past due among unpaid sales */
  daysOverdue: number;
  /** Oldest unpaid past-due sale date, if any */
  oldestOverdueDate?: Date;
  /** When that oldest past-due sale fell due (saleDate + creditLimitDays) */
  oldestOverdueDueDate?: Date;
  /**
   * Distinct identities that entered this customer's sales (name + role snapshot).
   * Used by Overdue Alerts to filter by entry person / department. Money columns on
   * those pages stay the customer's true totals, so this never scopes the math.
   */
  saleEntries?: { name: string; role?: string }[];
  approvalStatus: "pending" | "approved";
  /** Entering user's ObjectId — source of truth; join to User for details */
  createdBy?: string;
  /** Resolved from User by `createdBy` (falls back to the legacy stored snapshot) */
  createdByName?: string;
  /** Department role key of the entering user, resolved at read time */
  createdByRole?: string;
  approvedByName?: string;

  /** Highest overdueDays from bills register (PendingBill.overdueDays where pendingAmount > 0) */
  billsMaxOverdueDays: number;
  /**
   * Narrowest / widest credit term (in days) across this party's OPEN bills —
   * each bill's own `billDate → dueOn` gap, same computation as the Credit Term
   * column on Pending Bills. `null` when no open bill carries a due date, so
   * there is no term to count. The Customers list renders min===max as one
   * number and min!==max as "7–30".
   */
  billTermMin: number | null;
  billTermMax: number | null;
  /**
   * Manual term override saved on the customer (`null` = none). The list shows
   * this FIRST, before the derived bill range, so a hand-fixed customer is
   * pinned against pending-bill imports. See `ICustomer.termMinDays`.
   */
  termMinDays: number | null;
  termMaxDays: number | null;
  /** Whether this customer has any sales */
  hasSalesData: boolean;
  /** Whether this customer has any open pending bills */
  hasBillsData: boolean;
};

export type CustomerCreditsFilter = {
  q?: string;
  /**
   * Who is looking:
   * - undefined → only approved customers (safe default for dashboards/reports/selects)
   * - SessionUser → approved + pending visible to that user (admin or creator)
   */
  viewer?: { id: string; roles: string[] } | null;
  /** Force approval filter: "approved" | "pending" | "all" (still visibility-scoped for viewer) */
  approval?: "approved" | "pending" | "all";
  /**
   * Department-app scope (see the department dashboards). Sales and bills are
   * scoped by their routing `departments` field — the same filter the app's
   * list pages use. Payments have no routing field, so they are scoped by
   * `createdByRole`, the entry-time department snapshot. The customer list
   * itself is deliberately NOT filtered: "Total Customers" and per-category
   * counts stay company-wide, only the money becomes department-scoped.
   */
  department?: Role | null;
  /** Extra scope for the branches app: one branch's sales/bills (payments are not branch-scoped). */
  branchId?: string | null;
};

function canSeePending(
  viewer: { id: string; roles: string[] } | null | undefined,
  createdBy: string | Types.ObjectId | undefined | null
): boolean {
  if (!viewer) return false;
  if (viewer.roles.includes("admin")) return true;
  // Normalize: value may be a real ObjectId or a legacy hex string
  return !!createdBy && String(createdBy) === viewer.id;
}

export async function getCustomerCredits(
  filter: CustomerCreditsFilter = {}
): Promise<CustomerCreditRow[]> {
  await db();
  const query: Record<string, unknown> = {};
  if (filter.q) {
    const re = new RegExp(filter.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    query.name = re;
  }

  const approval = filter.approval ?? (filter.viewer ? "all" : "approved");

  const customers = await Customer.find(query)
    .sort({ name: 1 })
    .lean()
    .exec();

  const visible = customers.filter((c) => {
    const status = c.approvalStatus === "approved" ? "approved" : "pending";
    if (status === "pending" && !canSeePending(filter.viewer, c.createdBy)) {
      return false;
    }
    if (approval === "approved" && status !== "approved") return false;
    if (approval === "pending" && status !== "pending") return false;
    return true;
  });

  const ids = visible.map((c) => c._id);
  // Department-app scoping (see `CustomerCreditsFilter.department`): sales and
  // bills are filtered by their routing `departments` array plus optional
  // `branchId`; payments, which carry no routing field, by `createdByRole`.
  // Both spreads are empty when no department is set, so every existing caller
  // (admin/accounts overview, chat, selects) keeps its exact current behaviour.
  const routeScope: Record<string, unknown> = {};
  if (filter.department) routeScope.departments = filter.department;
  if (filter.branchId) routeScope.branchId = filter.branchId;
  const entryScope: Record<string, unknown> = {};
  if (filter.department) entryScope.createdByRole = filter.department;
  const [sales, payments] = await Promise.all([
    Sale.find({ customerId: { $in: ids }, ...routeScope })
      // createdBy/createdByRole/entryBy back the sale-entry filters on Overdue Alerts
      .select({
        customerId: 1,
        amount: 1,
        saleDate: 1,
        referenceId: 1,
        createdBy: 1,
        createdByRole: 1,
        entryBy: 1,
      })
      .lean()
      .exec(),
    // ONLY approved payments count toward collected / outstanding / overdue. A
    // `pending` payment is a claim that has not been released against a bill, so
    // including it here would make money appear collected before Accounts has
    // checked it — and would silently disagree with the Pending Bills register,
    // which is only reduced by `allocatePayment`.
    Payment.find({
      customerId: { $in: ids },
      approvalStatus: "approved",
      ...entryScope,
    })
      .select({ customerId: 1, rcvAmount: 1 })
      .lean()
      .exec(),
  ]);

  // The bills register. Matched on `customerId` first, then widened to an exact
  // case-insensitive whole-name match for rows written before the link existed
  // (or whose customer creation failed). Deduped on `_id` so a row can never be
  // counted twice. `pendingAmount > 0` matches the Pending Bills list, so a
  // settled bill drops out here exactly as it does there.
  const [linkedBills, unlinkedBills] = await Promise.all([
    PendingBill.find({
      customerId: { $in: ids },
      pendingAmount: { $gt: 0 },
      ...routeScope,
    })
      .select({ customerId: 1, partyName: 1, openingAmount: 1, pendingAmount: 1, overdueDays: 1, billDate: 1, dueOn: 1 })
      .lean()
      .exec(),
    visible.length
      ? PendingBill.find({
          pendingAmount: { $gt: 0 },
          ...routeScope,
          // A party's bills, but only the ones carrying no usable customerId
          $or: [{ customerId: { $exists: false } }, { customerId: null }],
          $and: [
            {
              $or: visible.map((c) => ({
                partyName: new RegExp(`^${escapeRegex(String(c.name ?? ""))}$`, "i"),
              })),
            },
          ],
        })
          .select({ customerId: 1, partyName: 1, openingAmount: 1, pendingAmount: 1, overdueDays: 1, billDate: 1, dueOn: 1 })
          .lean()
          .exec()
      : Promise.resolve([]),
  ]);

  const billsByCust = new Map<
    string,
    {
      pending: number;
      opening: number;
      count: number;
      maxOverdueDays: number;
      termMin: number | null;
      termMax: number | null;
    }
  >();
  const bumpBill = (
    key: string,
    opening: number,
    pending: number,
    overdueDays: number,
    term: number | null
  ) => {
    if (!key) return;
    const cur = billsByCust.get(key) ?? {
      pending: 0,
      opening: 0,
      count: 0,
      maxOverdueDays: 0,
      termMin: null as number | null,
      termMax: null as number | null,
    };
    cur.pending += pending;
    cur.opening += opening;
    cur.count += 1;
    if (overdueDays > cur.maxOverdueDays) cur.maxOverdueDays = overdueDays;
    // Narrowest / widest credit term across the party's open bills. Bills with
    // no due date carry no term, so they are skipped rather than counting as 0 —
    // a 0-day term is real (due the day it was billed) and must stay distinct.
    if (term !== null) {
      cur.termMin = cur.termMin === null ? term : Math.min(cur.termMin, term);
      cur.termMax = cur.termMax === null ? term : Math.max(cur.termMax, term);
    }
    billsByCust.set(key, cur);
  };
  for (const b of linkedBills) {
    bumpBill(
      String(b.customerId),
      b.openingAmount ?? 0,
      b.pendingAmount ?? 0,
      b.overdueDays ?? 0,
      creditTermDays(b.billDate, b.dueOn)
    );
  }
  for (const b of unlinkedBills) {
    // Key by the trimmed lowercase party name so a legacy row lands on the same
    // customer as its linked siblings; `_id` dedupe is unnecessary here because
    // the `customerId: null/absent` filter already excludes every linked row.
    const name = String(b.partyName ?? "").trim().toLowerCase();
    const owner = visible.find((c) => String(c.name ?? "").trim().toLowerCase() === name);
    if (owner) {
      bumpBill(
        String(owner._id),
        b.openingAmount ?? 0,
        b.pendingAmount ?? 0,
        b.overdueDays ?? 0,
        creditTermDays(b.billDate, b.dueOn)
      );
    }
  }

  // Resolve entering user details from the users collection by `createdBy` ObjectId.
  // Values may be a real ObjectId or a legacy hex string → normalize with String() first;
  // non-hex garbage (e.g. old snapshots) is dropped so User.find can't throw a CastError.
  // One batched lookup covers both the customers' and the sales' creators.
  const hexIds = (values: (string | Types.ObjectId | undefined | null)[]) => [
    ...new Set(
      values
        .map((v) => (v ? String(v) : ""))
        .filter((v) => /^[0-9a-fA-F]{24}$/.test(v))
    ),
  ];
  const creatorIds = hexIds([
    ...visible.map((c) => c.createdBy),
    ...sales.map((s) => s.createdBy),
  ]);
  const creators = creatorIds.length
    ? await User.find({ _id: { $in: creatorIds } })
        .select({ name: 1, role: 1 })
        .lean()
        .exec()
    : [];
  const creatorById = new Map(creators.map((u) => [String(u._id), u]));

  const salesByCust = new Map<
    string,
    {
      amount: number;
      saleDate: Date;
      referenceId?: string;
      createdBy?: Types.ObjectId;
      createdByRole?: string;
      entryBy?: string;
    }[]
  >();
  for (const s of sales) {
    const key = String(s.customerId);
    if (!salesByCust.has(key)) salesByCust.set(key, []);
    salesByCust.get(key)!.push({
      amount: s.amount,
      saleDate: new Date(s.saleDate),
      referenceId: s.referenceId,
      createdBy: s.createdBy,
      createdByRole: s.createdByRole,
      entryBy: s.entryBy,
    });
  }
  const paysByCust = new Map<string, number[]>();
  for (const p of payments) {
    const key = String(p.customerId);
    if (!paysByCust.has(key)) paysByCust.set(key, []);
    paysByCust.get(key)!.push(p.rcvAmount);
  }

  const now = new Date();

  return visible.map((c) => {
    const id = String(c._id);
    const creator = c.createdBy ? creatorById.get(String(c.createdBy)) : undefined;
    const creditLimitDays = c.creditLimitDays ?? 30;
    const custSales = salesByCust.get(id) ?? [];
    const custPays = (paysByCust.get(id) ?? []).map((amount) => ({ amount }));

    const totalSales = custSales.reduce((s, x) => s + x.amount, 0);
    const totalCollected = custPays.reduce((s, x) => s + x.amount, 0);

    const allocated = allocatePayments(custSales, custPays);

    // Outstanding is the BILLS register only. `pendingAmount` is already net of
    // every approved payment (allocatePayment is the only writer that lowers it), so
    // the sale FIFO is deliberately NOT added on top: the sales register is a
    // separate, parallel view of the same relationship, and summing it here would
    // double-count the money and make the figure disagree with the Pending Bills
    // and Completed Bills pages.
    const bill = billsByCust.get(id) ?? {
      pending: 0,
      opening: 0,
      count: 0,
      maxOverdueDays: 0,
      termMin: null as number | null,
      termMax: null as number | null,
    };
    const billsOutstanding = bill.pending;
    const totalBilled = totalSales + bill.opening;
    const outstanding = billsOutstanding;

    // Unpaid balance on the sales register, reported for VISIBILITY only. The sale
    // FIFO is also what drives the credit-term view below (which sales are past
    // their due date), but sale balances never contribute to `outstanding`.
    const salesOutstanding = allocated.reduce((s, x) => s + Math.max(0, x.remaining), 0);

    let overdueAmount = 0;
    let maxOverdue = 0;
    let oldestOverdueDate: Date | undefined;
    let oldestOverdueDueDate: Date | undefined;

    for (const s of allocated) {
      if (s.remaining <= 0) continue;
      const od = daysOverdue(s.saleDate, creditLimitDays, now);
      if (od > 0) {
        overdueAmount += s.remaining;
        if (od > maxOverdue) maxOverdue = od;
        if (!oldestOverdueDate || s.saleDate < oldestOverdueDate) {
          oldestOverdueDate = s.saleDate;
          oldestOverdueDueDate = dueDate(s.saleDate, creditLimitDays);
        }
      }
    }

    // Distinct identities that entered this customer's sales: legacy `entryBy` name
    // snapshot first, falling back to the resolved `createdBy` user. Rows are deduped on
    // name + role; entries with neither land as "Unknown" with no role so the alerts
    // page can offer an "Unknown" department option.
    const entrySeen = new Map<string, { name: string; role?: string }>();
    for (const s of custSales) {
      const creator = s.createdBy ? creatorById.get(String(s.createdBy)) : undefined;
      const name = s.entryBy ?? creator?.name;
      const role = s.createdByRole ?? (creator ? primaryRole(creator.role) : undefined);
      const key = `${name ?? ""}|${role ?? ""}`;
      if (!entrySeen.has(key)) {
        entrySeen.set(key, name ? { name, role } : { name: "Unknown" });
      }
    }
    const saleEntries = [...entrySeen.values()].sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    return {
      customerId: id,
      name: c.name,
      address: c.address,
      contactPerson: c.contactPerson,
      contactNumber: c.contactNumber,
      category: c.category,
      group: c.group || "Not a Group of Company",
      branch: c.branch,
      creditLimitDays,
      rawCreditLimitDays: c.creditLimitDays ?? null,
      totalSales,
      totalCollected,
      billsOutstanding,
      totalBilled,
      salesOutstanding,
      saleCount: custSales.length,
      billCount: bill.count,
      outstanding,
      status: overdueAmount > 0 ? "overdue" : "within",
      overdueAmount,
      daysOverdue: maxOverdue,
      oldestOverdueDate,
      oldestOverdueDueDate,
      saleEntries,
      approvalStatus: c.approvalStatus === "approved" ? "approved" : "pending",
      createdBy: c.createdBy ? String(c.createdBy) : undefined,
      createdByName: creator?.name ?? c.createdByName,
      createdByRole:
        c.createdByRole ?? (creator ? primaryRole(creator.role) : undefined),
      approvedByName: c.approvedByName,
      billsMaxOverdueDays: bill.maxOverdueDays ?? 0,
      billTermMin: bill.termMin,
      billTermMax: bill.termMax,
      termMinDays: c.termMinDays ?? null,
      termMaxDays: c.termMaxDays ?? null,
      hasSalesData: custSales.length > 0,
      hasBillsData: bill.count > 0,
    };
  });
}

export async function getCustomerCredit(
  customerId: string
): Promise<CustomerCreditRow | null> {
  const rows = await getCustomerCredits();
  return rows.find((r) => r.customerId === customerId) ?? null;
}

export async function nextSaleReferenceId(): Promise<string> {
  await db();
  const year = new Date().getFullYear();
  const prefix = `SALE-${year}-`;
  const last = await Sale.findOne({ referenceId: new RegExp(`^${prefix}`) })
    .sort({ referenceId: -1 })
    .select({ referenceId: 1 })
    .lean()
    .exec();
  let seq = 1;
  if (last?.referenceId) {
    const n = parseInt(last.referenceId.slice(prefix.length), 10);
    if (!Number.isNaN(n)) seq = n + 1;
  }
  return `${prefix}${String(seq).padStart(4, "0")}`;
}
