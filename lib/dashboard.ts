/**
 * SERVER-ONLY read layer for the Admin / Accounts Overview dashboard.
 *
 * The department dashboards (`components/views/DashboardView.tsx`) keep using
 * `getCustomerCredits` on its own; this module exists because the overview has to
 * answer questions about the BILLS register — which is where almost all of the
 * real receivable lives. `Sale`/`Payment` together are a rounding error next to
 * `PendingBill.pendingAmount` (see the register notes in AGENTS.md), so a
 * dashboard built on sales numbers alone would show an almost empty picture.
 *
 * ## Register rules this file must not break
 *
 * - `outstanding` is the BILLS register only (`r.outstanding` === `billsOutstanding`).
 *   Never recompute it as `sales − collected`; that is a third, different number
 *   that disagrees with the Pending Bills and Completed Bills pages and goes
 *   negative for any party whose money lives in the bills register.
 * - Only `approvalStatus: "approved"` payments count as collected, everywhere.
 *   A pending payment is a claim that has not been released against a bill.
 * - Customer money totals are approved-only. `viewer` is passed in so the
 *   *pending approval queue count* can see what the viewer is allowed to see,
 *   but it never widens the money.
 * - The bills register's "overdue" is the MANUAL `overdueDays` typed in col G.
 *   It is a different question from `CustomerCreditRow.overdueAmount` (sales
 *   past `dueDate`). Both appear on the overview, and every surface that shows
 *   one says which register it came from.
 * - `promisedPassed` is derived HERE, never in render: rows are SSR'd and then
 *   hydrated, so a `new Date()` evaluated during render can disagree with the
 *   server's answer at a midnight boundary and trip a hydration mismatch.
 * - Every figure below comes from an aggregate. Nothing sums a capped
 *   `find().limit()` result.
 */

import { db } from "@/lib/db";
import { getCustomerCredits } from "@/lib/credit";
import { Customer } from "@/lib/models/Customer";
import { Payment } from "@/lib/models/Payment";
import { PendingBill } from "@/lib/models/PendingBill";
import { Sale } from "@/lib/models/Sale";
import { ActivityLog } from "@/lib/models/ActivityLog";
import { billWarnings, daysSinceBill } from "@/lib/pendingBills";
import { DEPARTMENT_ROLES, ROLE_HOMES } from "@/lib/nav";
import { ROLE_LABELS, type Role } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Period selection                                                    */
/* ------------------------------------------------------------------ */

export const DASHBOARD_RANGES = [
  { key: "all", label: "All time", months: 0 },
  { key: "mtd", label: "This month", months: 0 },
  { key: "3m", label: "Last 3 months", months: 3 },
  { key: "6m", label: "Last 6 months", months: 6 },
  { key: "12m", label: "Last 12 months", months: 12 },
] as const;

export type DashboardRange = (typeof DASHBOARD_RANGES)[number]["key"];

export function isDashboardRange(v: string | undefined): v is DashboardRange {
  return DASHBOARD_RANGES.some((r) => r.key === v);
}

/**
 * Start of the selected period, or `null` for all-time.
 *
 * `mtd` has to be computed on the *local* calendar, not from a 30-day offset, or
 * "This month" would silently include part of the previous month on the 1st–2nd.
 */
function rangeStart(range: DashboardRange): Date | null {
  if (range === "all") return null;
  const now = new Date();
  if (range === "mtd") return new Date(now.getFullYear(), now.getMonth(), 1);
  const months = DASHBOARD_RANGES.find((r) => r.key === range)?.months ?? 0;
  return new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
}

export function rangeLabel(range: DashboardRange): string {
  return DASHBOARD_RANGES.find((r) => r.key === range)?.label ?? "All time";
}

/**
 * A bill this old with nothing on it is worth chasing even when nobody has typed
 * an aging for it. Bill age is derived from `billDate`, so this is an age-based
 * nudge — it never claims the bill is "overdue", which is the manual col G's job.
 */
const ATTENTION_AGE_DAYS = 90;

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** Col G is a manual figure, so these buckets are read off the stored value. */
export type AgingBucket = {
  key: string;
  label: string;
  count: number;
  amount: number;
  /** 0 = within terms … 3 = 90+ days, used to pick the severity colour. */
  severity: 0 | 1 | 2 | 3;
};

export type RouteSlice = {
  key: string;
  label: string;
  count: number;
  amount: number;
  /** `null` = no routing prefix matched, i.e. the Accounts-only rows. */
  home: string | null;
};

export type MonthPoint = {
  /** `YYYY-MM`, the key a line chart joins on. */
  key: string;
  label: string;
  sales: number;
  salesCount: number;
  collected: number;
  collectedCount: number;
};

export type TopParty = {
  name: string;
  count: number;
  amount: number;
  maxOverdueDays: number;
  oldestBillDate: Date | null;
};

/**
 * A lean `PendingBill` as the attention-table needs it. The Mongoose interface
 * types `_id` as `string` and `dueOn` as `Date`, but the driver hands back an
 * ObjectId and an absent date, and `followUps` is missing entirely on rows
 * written before the feature — so the read path spells out what it can rely on.
 */
type AttentionDoc = {
  _id: unknown;
  referenceNo: string;
  billNumber?: string;
  partyName: string;
  pendingAmount: number;
  overdueDays?: number;
  billDate: Date;
  dueOn?: Date | null;
  departments?: Role[];
  followUps?: { date: Date; note?: string; estimatedPaymentDate?: Date | null }[];
};

export type OverviewData = {
  range: DashboardRange;
  rangeLabel: string;
  trendLabel: string;
  /** Local-midnight cutoff behind the "older than 90 days" card. */
  agedOver90Cutoff: Date;
  /** Cumulative registers — all-time by definition, never period-scoped. */
  money: {
    sales: number;
    collected: number;
    collectionRate: number;
    /** Bills register only. */
    outstanding: number;
    /** Sales register only, past `saleDate + creditLimitDays`. */
    salesOverdueAmount: number;
    salesOverdueCustomers: number;
    withinTermCustomers: number;
    totalBilled: number;
    avgTerm: number;
  };
  customers: {
    approved: number;
    pending: number;
    withSales: number;
    withBills: number;
  };
  bills: {
    count: number;
    pending: number;
    opening: number;
    /** Bills carrying a manual `overdueDays > 0`, and what they owe. */
    overdueCount: number;
    overdueAmount: number;
    settledCount: number;
    settledAmount: number;
    avgBillAge: number;
  };
  aging: AgingBucket[];
  routes: RouteSlice[];
  /** Who TYPED the bill (`createdByRole`) — a different question from `routes`. */
  entryDepts: { label: string; count: number; amount: number }[];
  months: MonthPoint[];
  paymentTypes: { label: string; amount: number; count: number }[];
  bankTypes: { label: string; amount: number; count: number }[];
  terms: { days: number; count: number }[];
  topByOutstanding: TopParty[];
  topByOverdue: TopParty[];
  /** Bills-register overdue, grouped by party — the alert view. */
  topOverdueParties: TopParty[];
  overduePartiesCount: number;
  recentPayments: {
    id: string;
    date: Date;
    customer: string;
    amount: number;
    paymentType: string;
    bank: string;
    entryBy: string;
  }[];
  attention: {
    pendingPayments: number;
    pendingPaymentsAmount: number;
    pendingCustomers: number;
    billsFlaggedOverdue: number;
    billsFlaggedOverdueAmount: number;
    billsAgedOver90: number;
    billsAgedOver90Amount: number;
    billsWithFollowUps: number;
    promisesPassed: number;
    /** Exact register-wide total behind the capped `attentionBills` table. */
    billsNeedingAttention: number;
  };
  attentionBills: {
    id: string;
    referenceNo: string;
    billNumber: string;
    partyName: string;
    pendingAmount: number;
    overdueDays: number;
    age: number;
    warnings: string[];
    promise: string;
  }[];
  recentActivity: {
    id: string;
    action: string;
    module: string;
    userName: string;
    detail: string;
    timestamp: Date;
  }[];
};

/* ------------------------------------------------------------------ */
/* Aggregation helpers                                                  */
/* ------------------------------------------------------------------ */

type MonthAgg = { _id: string; n: number; v: number };

/**
 * Fill the gaps in a month series so a line chart never joins across a missing
 * month. Sales are sporadic (and currently only exist for 2026-09), so without
 * this the two series would be drawn against mismatched x positions.
 */
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  if (!y || !m) return key;
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "short" });
}

function buildMonthSeries(
  sales: MonthAgg[],
  collected: MonthAgg[],
  months: number
): MonthPoint[] {
  const now = new Date();
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    keys.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  }
  // Keep any month the data reaches beyond the window, oldest first, so a long
  // history is never truncated away by a small `months` choice.
  const all = new Set([
    ...keys,
    ...sales.map((s) => s._id),
    ...collected.map((c) => c._id),
  ]);
  const byKey = new Map<string, MonthPoint>();
  for (const k of [...all].sort()) {
    byKey.set(k, {
      key: k,
      label: monthLabel(k),
      sales: 0,
      salesCount: 0,
      collected: 0,
      collectedCount: 0,
    });
  }
  for (const s of sales) {
    const p = byKey.get(s._id);
    if (!p) continue;
    p.sales += s.v ?? 0;
    p.salesCount += s.n ?? 0;
  }
  for (const c of collected) {
    const p = byKey.get(c._id);
    if (!p) continue;
    p.collected += c.v ?? 0;
    p.collectedCount += c.n ?? 0;
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/* ------------------------------------------------------------------ */
/* The overview                                                         */
/* ------------------------------------------------------------------ */

export async function getOverview(opts: {
  range: DashboardRange;
  viewer?: { id: string; roles: string[] } | null;
  /** Admin-only panels (activity feed). */
  isAdmin?: boolean;
}): Promise<OverviewData> {
  const { range, viewer = null, isAdmin = false } = opts;
  await db();
  const from = rangeStart(range);
  const windowMonths = from
    ? (from.getFullYear() - new Date().getFullYear()) * 12 +
      (from.getMonth() - new Date().getMonth()) +
      1
    : 12;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  // The outstanding register. Every bill figure on this page comes from this
  // one filter, so the header, the aging chart, the route split and the top-debtor
  // table can never describe different sets of rows.
  const openBills = { pendingAmount: { $gt: 0 } };

  // Approved-only. A pending payment has not been released against a bill, so
  // quoting it as collected would make money appear in hand before Accounts has
  // checked it — and would disagree with the Pending Bills register, which only
  // `allocatePayment` ever lowers.
  const approvedMatch: Record<string, unknown> = { approvalStatus: "approved" };

  const creditsPromise = getCustomerCredits({ viewer });
  const billsTotalPromise = PendingBill.aggregate<{
    _id: null;
    count: number;
    pending: number;
    opening: number;
    overdueCount: number;
    overdueAmount: number;
  }>([
    { $match: openBills },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        pending: { $sum: "$pendingAmount" },
        opening: { $sum: "$openingAmount" },
        // Col G is the user's own manual figure — the stored value is the
        // single source of truth for the cell, the filter and this count.
        overdueCount: { $sum: { $cond: [{ $gt: [{ $ifNull: ["$overdueDays", 0] }, 0] }, 1, 0] } },
        overdueAmount: {
          $sum: { $cond: [{ $gt: [{ $ifNull: ["$overdueDays", 0] }, 0] }, "$pendingAmount", 0] },
        },
      },
    },
  ]);

  const agingPromise = PendingBill.aggregate<{ _id: number; count: number; amount: number }>([
    { $match: openBills },
    {
      // `$bucket` cannot group on an expression, so the null-coalesce happens
      // first. `overdueDays` defaults to 0 in the schema, but rows written before
      // that default existed really do have no field, and `$bucket` silently
      // DROPS a document whose groupBy value is missing — which would shrink the
      // chart without any error.
      $project: {
        overdueDays: { $ifNull: ["$overdueDays", 0] },
        pendingAmount: 1,
      },
    },
    {
      $bucket: {
        groupBy: "$overdueDays",
        boundaries: [0, 1, 8, 15, 31, 61, 91, 9007199254740991],
        default: "other",
        output: { count: { $sum: 1 }, amount: { $sum: "$pendingAmount" } },
      },
    },
  ]);

  const routeMembersPromise = PendingBill.aggregate<{
    _id: string;
    count: number;
    amount: number;
  }>([
    { $match: { ...openBills, departments: { $exists: true, $ne: [] } } },
    { $unwind: "$departments" },
    {
      $group: {
        _id: "$departments",
        count: { $sum: 1 },
        amount: { $sum: "$pendingAmount" },
      },
    },
    { $sort: { amount: -1 } },
  ]);

  // Bills whose reference matched no routing prefix. These carry
  // `departments: []`, which is why they are visible to Accounts only — and why
  // this is a separate match rather than a member lookup.
  const unroutedPromise = PendingBill.aggregate<{ _id: null; count: number; amount: number }>([
    {
      $match: {
        ...openBills,
        $or: [{ departments: { $size: 0 } }, { departments: { $exists: false } }],
      },
    },
    { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: "$pendingAmount" } } },
  ]);

  const entryDeptPromise = PendingBill.aggregate<{
    _id: string | null;
    count: number;
    amount: number;
  }>([
    { $match: openBills },
    {
      $group: {
        _id: { $ifNull: ["$createdByRole", "unknown"] },
        count: { $sum: 1 },
        amount: { $sum: "$pendingAmount" },
      },
    },
    { $sort: { amount: -1 } },
  ]);

  // Exact register-wide counts for the attention cards. Both conditions are
  // expressible in Mongo (`overdueDays` is a stored field, and `age` is derived
  // from the stored `billDate`), so these are true totals — unlike the capped
  // `attentionBills` table, which is a 12-row sample and must never be presented
  // as a count.
  //
  // The 90-day cutoff is `today - 91` with `$lte`, which is exactly the predicate
  // the Pending Bills list applies for `?minDays=91` ("at least 91 days old" =
  // "older than 90 days"). Deriving it any other way would let the card and the
  // list it links to disagree by a day at the boundary.
  const agedOver90Cutoff = new Date(startOfToday);
  agedOver90Cutoff.setDate(agedOver90Cutoff.getDate() - ATTENTION_AGE_DAYS - 1);
  const agedOver90Promise = PendingBill.aggregate<{
    _id: null;
    count: number;
    amount: number;
  }>([
    { $match: { ...openBills, billDate: { $lte: agedOver90Cutoff } } },
    { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: "$pendingAmount" } } },
  ]);
  const needsAttentionPromise = PendingBill.aggregate<{
    _id: null;
    count: number;
    amount: number;
  }>([
    {
      $match: {
        ...openBills,
        $or: [{ overdueDays: { $gt: 0 } }, { billDate: { $lte: agedOver90Cutoff } }],
      },
    },
    { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: "$pendingAmount" } } },
  ]);

  const topOutstandingPromise = PendingBill.aggregate<{
    _id: string;
    count: number;
    amount: number;
    maxOverdue: number;
    oldest: Date;
  }>([
    { $match: openBills },
    {
      $group: {
        _id: "$partyName",
        count: { $sum: 1 },
        amount: { $sum: "$pendingAmount" },
        maxOverdue: { $max: { $ifNull: ["$overdueDays", 0] } },
        oldest: { $min: "$billDate" },
      },
    },
    { $sort: { amount: -1 } },
    { $limit: 10 },
  ]);

  // Overdue alerts are driven by the BILLS register (the manual `overdueDays` in
  // col G), not the sales register. These two aggregates are the pending-bills
  // counterpart of the sales-register `topByOverdue` below.
  const overdueBillsMatch = { ...openBills, overdueDays: { $gt: 0 } };
  const overduePartiesCountPromise = PendingBill.aggregate<{ _id: null; count: number }>([
    { $match: overdueBillsMatch },
    { $group: { _id: "$partyName" } },
    { $count: "count" },
  ]);
  const topOverduePartiesPromise = PendingBill.aggregate<{
    _id: string;
    count: number;
    amount: number;
    maxOverdue: number;
  }>([
    { $match: overdueBillsMatch },
    {
      $group: {
        _id: "$partyName",
        count: { $sum: 1 },
        amount: { $sum: "$pendingAmount" },
        maxOverdue: { $max: { $ifNull: ["$overdueDays", 0] } },
      },
    },
    { $sort: { amount: -1 } },
    { $limit: 10 },
  ]);

  const followUpPromise = PendingBill.aggregate<{
    _id: null;
    hasFollowUps: number;
    withPromise: number;
    promisePassed: number;
    promisePassedAmount: number;
  }>([
    { $match: openBills },
    {
      $project: {
        hasFollowUps: { $gt: [{ $size: { $ifNull: ["$followUps", []] } }, 0] },
        // The live promise is the ETA of the most RECENT follow-up that carried
        // one — a later call ending in "no date given" must not blank it. Mongo
        // cannot match "the last element of an array", so this is `$filter` + last
        // element. Both `$let`s are nested because a `$$var` is only in scope
        // inside its own `in:` — a later `$addFields` referring to `$$eta` is an
        // "undefined variable" error, not a field read.
        eta: {
          $let: {
            vars: {
              dated: {
                $filter: {
                  input: { $ifNull: ["$followUps", []] },
                  cond: { $ne: [{ $ifNull: ["$$this.estimatedPaymentDate", null] }, null] },
                },
              },
            },
            in: {
              $let: {
                vars: { last: { $ifNull: [{ $arrayElemAt: ["$$dated", -1] }, null] } },
                in: { $ifNull: ["$$last.estimatedPaymentDate", null] },
              },
            },
          },
        },
        pendingAmount: 1,
      },
    },
    {
      $group: {
        _id: null,
        hasFollowUps: { $sum: { $cond: ["$hasFollowUps", 1, 0] } },
        withPromise: { $sum: { $cond: [{ $ne: ["$eta", null] }, 1, 0] } },
        // "Passed" means strictly before local midnight today, so a promise stays
        // un-passed for the whole of its own day.
        promisePassed: {
          $sum: { $cond: [{ $and: [{ $ne: ["$eta", null] }, { $lt: ["$eta", startOfToday] }] }, 1, 0] },
        },
        promisePassedAmount: {
          $sum: {
            $cond: [{ $and: [{ $ne: ["$eta", null] }, { $lt: ["$eta", startOfToday] }] }, "$pendingAmount", 0],
          },
        },
      },
    },
  ]);

  // A sample of open bills for the "needs attention" table. Capped, and the cap is
  // surfaced in the UI rather than silently truncating the register.
  const attentionDocsPromise = PendingBill.find(openBills)
    .select({
      referenceNo: 1,
      billNumber: 1,
      partyName: 1,
      pendingAmount: 1,
      overdueDays: 1,
      billDate: 1,
      dueOn: 1,
      departments: 1,
      followUps: 1,
    })
    .sort({ overdueDays: -1, pendingAmount: -1 })
    .limit(300)
    .lean()
    .exec() as unknown as Promise<AttentionDoc[]>;

  // A settled bill is `pendingAmount <= 0`. Its COUNT comes from the bill; its
  // MONEY does not — `openingAmount` is what the bill was opened at, not what was
  // paid against it. The money actually released against bills is the sum of
  // `allocatedAmount` on approved payments, which is the same figure
  // `allocatePayment` wrote when it lowered `pendingAmount`.
  const settledPromise = PendingBill.aggregate<{ _id: null; count: number }>([
    { $match: { pendingAmount: { $lte: 0 } } },
    { $group: { _id: null, count: { $sum: 1 } } },
  ]);

  const releasedPromise = Payment.aggregate<{ _id: null; v: number }>([
    { $match: approvedMatch },
    { $group: { _id: null, v: { $sum: "$allocatedAmount" } } },
  ]);

  const avgAgePromise = PendingBill.aggregate<{ _id: null; avg: number }>([
    { $match: openBills },
    { $group: { _id: null, avg: { $avg: "$daysSinceBill" } } },
  ]);

  const salesMonthsPromise = Sale.aggregate<MonthAgg>([
    ...(from ? [{ $match: { saleDate: { $gte: from } } }] : []),
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m", date: "$saleDate" } },
        n: { $sum: 1 },
        v: { $sum: "$amount" },
      },
    },
  ]);

  const paymentMonthsPromise = Payment.aggregate<MonthAgg>([
    { $match: approvedMatch },
    ...(from ? [{ $match: { rcvDate: { $gte: from } } }] : []),
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m", date: "$rcvDate" } },
        n: { $sum: 1 },
        v: { $sum: "$rcvAmount" },
      },
    },
  ]);

  const payTypeRowsPromise = Payment.aggregate<{ _id: string | null; v: number; n: number }>([
    { $match: approvedMatch },
    { $group: { _id: { $ifNull: ["$paymentType", "Other"] }, v: { $sum: "$rcvAmount" }, n: { $sum: 1 } } },
    { $sort: { v: -1 } },
  ]);

  const bankTypeRowsPromise = Payment.aggregate<{ _id: string | null; v: number; n: number }>([
    { $match: approvedMatch },
    {
      $group: {
        _id: { $ifNull: [{ $ifNull: ["$bankType", "$bankName"] }, "Cash / Other"] },
        v: { $sum: "$rcvAmount" },
        n: { $sum: 1 },
      },
    },
    { $sort: { v: -1 } },
  ]);

  const termsPromise = Customer.aggregate<{ _id: number | null; n: number }>([
    { $match: { approvalStatus: "approved" } },
    { $group: { _id: "$creditLimitDays", n: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  const pendingCountsPromise = Promise.all([
    Payment.countDocuments({ approvalStatus: "pending" }),
    Payment.aggregate<{ _id: null; v: number }>([
      { $match: { approvalStatus: "pending" } },
      { $group: { _id: null, v: { $sum: "$rcvAmount" } } },
    ]),
  ]);

  // Pending customers are visible to admin or to their own creator. The
  // aggregate cannot express that, so this is a bounded read of the pending set
  // only — never the whole collection.
  const pendingCustomersPromise = Customer.find({ approvalStatus: "pending" })
    .select({ createdBy: 1 })
    .limit(2000)
    .lean()
    .exec();

  const recentPaymentsPromise = Payment.find({ approvalStatus: "approved" })
    .sort({ rcvDate: -1, createdAt: -1 })
    .limit(8)
    .select({ rcvDate: 1, rcvAmount: 1, paymentType: 1, bankType: 1, bankName: 1, entryBy: 1, customerId: 1 })
    .lean()
    .exec();

  const recentActivityPromise = isAdmin
    ? ActivityLog.find()
        .sort({ timestamp: -1 })
        .limit(8)
        .select({ action: 1, module: 1, userName: 1, detail: 1, timestamp: 1 })
        .lean()
        .exec()
    : Promise.resolve([]);

  const [
    credits,
    billsTotalRows,
    agingRows,
    routeMemberRows,
    unroutedRows,
    entryDeptRows,
    agedOver90Rows,
    needsAttentionRows,
    topOutstandingRows,
    overduePartiesCountRows,
    topOverduePartiesRows,
    followUpRows,
    attentionDocs,
    settledRows,
    releasedRows,
    avgAgeRows,
    salesMonths,
    paymentMonths,
    payTypeRows,
    bankTypeRows,
    termRows,
    [pendingPayments, pendingPaymentAmountRows],
    pendingCustomerDocs,
    recentPaymentDocs,
    activityDocs,
  ] = await Promise.all([
    creditsPromise,
    billsTotalPromise,
    agingPromise,
    routeMembersPromise,
    unroutedPromise,
    entryDeptPromise,
    agedOver90Promise,
    needsAttentionPromise,
    topOutstandingPromise,
    overduePartiesCountPromise,
    topOverduePartiesPromise,
    followUpPromise,
    attentionDocsPromise,
    settledPromise,
    releasedPromise,
    avgAgePromise,
    salesMonthsPromise,
    paymentMonthsPromise,
    payTypeRowsPromise,
    bankTypeRowsPromise,
    termsPromise,
    pendingCountsPromise,
    pendingCustomersPromise,
    recentPaymentsPromise,
    recentActivityPromise,
  ]);

  /* ---- money (cumulative, approved-only customers) ---- */
  const sales = credits.reduce((s, r) => s + r.totalSales, 0);
  // Sum the row field, never `sales - collected`: that shortcut is a third,
  // different number and disagrees with the Pending Bills pages.
  const outstanding = credits.reduce((s, r) => s + r.outstanding, 0);
  const collected = credits.reduce((s, r) => s + r.totalCollected, 0);
  const salesOverdueAmount = credits.reduce((s, r) => s + r.overdueAmount, 0);
  const totalBilled = credits.reduce((s, r) => s + r.totalBilled, 0);
  const salesOverdueCustomers = credits.filter((r) => r.status === "overdue").length;
  const avgTerm = credits.length
    ? Math.round(credits.reduce((s, r) => s + r.creditLimitDays, 0) / credits.length)
    : 0;

  /* ---- customers ---- */
  const approvedCustomers = credits.filter((r) => r.approvalStatus === "approved");
  const visiblePendingCustomers = pendingCustomerDocs.filter(
    (c) => viewer && (viewer.roles.includes("admin") || (c.createdBy ? String(c.createdBy) === viewer.id : false))
  ).length;

  /* ---- bills ---- */
  const bt = billsTotalRows[0];
  const st = settledRows[0];
  const fu = followUpRows[0];

  // `lo` is the `$bucket` boundary that starts each range, so the definition and
  // the aggregation cannot drift apart.
  const AGING_DEF: { key: string; label: string; severity: AgingBucket["severity"]; lo: number }[] = [
    { key: "notdue", label: "Not yet due", severity: 0, lo: 0 },
    { key: "1-7", label: "1–7 days", severity: 1, lo: 1 },
    { key: "8-14", label: "8–14 days", severity: 1, lo: 8 },
    { key: "15-30", label: "15–30 days", severity: 2, lo: 15 },
    { key: "31-60", label: "31–60 days", severity: 2, lo: 31 },
    { key: "61-90", label: "61–90 days", severity: 3, lo: 61 },
    { key: "90+", label: "90+ days", severity: 3, lo: 91 },
  ];
  const agingByLo = new Map<number, { count: number; amount: number }>();
  for (const row of agingRows) {
    if (typeof row._id !== "number") continue;
    agingByLo.set(row._id, { count: row.count, amount: row.amount });
  }
  const aging: AgingBucket[] = AGING_DEF.map((d) => {
    const acc = agingByLo.get(d.lo) ?? { count: 0, amount: 0 };
    return { key: d.key, label: d.label, severity: d.severity, count: acc.count, amount: acc.amount };
  });

  /* ---- routes ---- */
  const routeMembers = new Map(
    routeMemberRows.map((r) => [String(r._id), { count: r.count, amount: r.amount }])
  );
  const routes: RouteSlice[] = DEPARTMENT_ROLES.filter((r) => routeMembers.has(r)).map((r) => {
    const m = routeMembers.get(r)!;
    return { key: r, label: ROLE_LABELS[r], count: m.count, amount: m.amount, home: ROLE_HOMES[r] };
  });
  // A bill can carry MORE THAN ONE department (a prefix may legitimately route
  // to several lists), so the routed slices deliberately do NOT sum to the
  // register — they are "bills visible in this app", not a partition of the money.
  // `Accounts only` is the one slice that is exclusive, and it is what the
  // unrouted aggregate counts.
  const unroutedRow = unroutedRows[0];
  if (unroutedRow && unroutedRow.count > 0) {
    routes.push({
      key: "unrouted",
      label: "Accounts only",
      count: unroutedRow.count,
      amount: unroutedRow.amount,
      home: null,
    });
  }

  /* ---- attention ---- */
  const attentionBills = attentionDocs
    .map((b) => {
      const warnings = billWarnings({
        referenceNo: b.referenceNo,
        billDate: b.billDate,
        departments: b.departments,
      });
      const fuList = b.followUps ?? [];
      let promise: Date | null = null;
      // Walk newest → oldest and take the first entry that named a date. A later
      // call ending in "no date given" must not blank out a promise the customer
      // is still being held to.
      for (let i = fuList.length - 1; i >= 0 && !promise; i -= 1) {
        const eta = fuList[i]?.estimatedPaymentDate;
        if (eta) promise = new Date(eta);
      }
      const promisePassed = promise !== null && promise.getTime() < startOfToday.getTime();
      const overdueDays = b.overdueDays ?? 0;
      // `daysSinceBill` already tolerates a missing `dueOn`, so normalise it once
      // here rather than branching at each call site.
      const dueOn = b.dueOn ?? undefined;
      const age = daysSinceBill(b.billDate, dueOn, overdueDays);
      // "Needs attention" is the union of the four things a person must act on,
      // so a single table can be the worklist.
      const needsAction =
        warnings.length > 0 || overdueDays > 0 || promisePassed || age > ATTENTION_AGE_DAYS;
      return {
        id: String(b._id),
        referenceNo: b.referenceNo,
        billNumber: b.billNumber || b.referenceNo,
        partyName: b.partyName,
        pendingAmount: b.pendingAmount,
        overdueDays,
        age,
        warnings,
        promise: promisePassed ? "passed" : promise ? "upcoming" : "",
        needsAction,
      };
    })
    .filter((b) => b.needsAction)
    .slice(0, 12)
    .map((b) => ({
      id: b.id,
      referenceNo: b.referenceNo,
      billNumber: b.billNumber,
      partyName: b.partyName,
      pendingAmount: b.pendingAmount,
      overdueDays: b.overdueDays,
      age: b.age,
      warnings: b.warnings,
      promise: b.promise,
    }));

  const nameById = new Map(credits.map((r) => [r.customerId, r.name]));

  return {
    range,
    rangeLabel: rangeLabel(range),
    /**
     * The trend x-axis is a trailing window, not the whole register: "all" seeds
     * the last 12 months so a sparse register still gets a readable axis. Saying
     * "all time" under a 12-month axis is the kind of label that makes a number
     * look wrong when it is not.
     */
    trendLabel: from ? rangeLabel(range) : "Last 12 months",
    agedOver90Cutoff,
    money: {
      sales,
      collected,
      collectionRate: sales > 0 ? collected / sales : 0,
      outstanding,
      salesOverdueAmount,
      salesOverdueCustomers,
      withinTermCustomers: credits.length - salesOverdueCustomers,
      totalBilled,
      avgTerm,
    },
    customers: {
      approved: approvedCustomers.length,
      pending: visiblePendingCustomers,
      withSales: credits.filter((r) => r.saleCount > 0).length,
      withBills: credits.filter((r) => r.billCount > 0).length,
    },
    bills: {
      count: bt?.count ?? 0,
      pending: bt?.pending ?? 0,
      opening: bt?.opening ?? 0,
      // Col G is a manual entry, so the bills register and the sales register
      // will NOT agree on "overdue" — they answer different questions. Both are
      // surfaced, each labelled with the register it came from.
      overdueCount: bt?.overdueCount ?? 0,
      overdueAmount: bt?.overdueAmount ?? 0,
      settledCount: st?.count ?? 0,
      settledAmount: releasedRows[0]?.v ?? 0,
      avgBillAge: bt?.count ? Math.round(avgAgeRows[0]?.avg ?? 0) : 0,
    },
    aging,
    routes,
    entryDepts: entryDeptRows.map((r) => ({
      label: r._id && r._id !== "unknown" && r._id in ROLE_LABELS
        ? ROLE_LABELS[r._id as Role]
        : "Unknown",
      count: r.count,
      amount: r.amount,
    })),
    months: buildMonthSeries(salesMonths, paymentMonths, windowMonths),
    paymentTypes: payTypeRows.map((r) => ({ label: String(r._id), amount: r.v, count: r.n })),
    bankTypes: bankTypeRows.map((r) => ({ label: String(r._id), amount: r.v, count: r.n })),
    terms: termRows
      // Blank Credit Limit (Days) groups under a null bucket — `Number(null)` is
      // 0, which would mislabel those customers as a real 0-day term.
      .filter((r) => r._id !== null)
      .map((r) => ({ days: Number(r._id), count: r.n }))
      .filter((t) => Number.isFinite(t.days)),
    topByOutstanding: topOutstandingRows.map((r) => ({
      name: String(r._id),
      count: r.count,
      amount: r.amount,
      maxOverdueDays: r.maxOverdue ?? 0,
      oldestBillDate: r.oldest,
    })),
    topByOverdue: [...credits]
      .filter((r) => r.overdueAmount > 0)
      .sort((a, b) => b.overdueAmount - a.overdueAmount)
      .slice(0, 10)
      .map((r) => ({
        name: r.name,
        count: r.billCount,
        amount: r.overdueAmount,
        maxOverdueDays: r.daysOverdue,
        oldestBillDate: r.oldestOverdueDate ?? null,
      })),
    topOverdueParties: topOverduePartiesRows.map((r) => ({
      name: String(r._id),
      count: r.count,
      amount: r.amount,
      maxOverdueDays: r.maxOverdue ?? 0,
      oldestBillDate: null,
    })),
    overduePartiesCount: overduePartiesCountRows[0]?.count ?? 0,
    recentPayments: recentPaymentDocs.map((p) => ({
      id: String(p._id),
      date: new Date(p.rcvDate),
      customer: nameById.get(String(p.customerId)) ?? "—",
      amount: p.rcvAmount,
      paymentType: p.paymentType,
      bank: p.bankType || p.bankName || "—",
      entryBy: p.entryBy ?? "—",
    })),
    attention: {
      pendingPayments: pendingPayments,
      pendingPaymentsAmount: pendingPaymentAmountRows[0]?.v ?? 0,
      pendingCustomers: visiblePendingCustomers,
      billsFlaggedOverdue: bt?.overdueCount ?? 0,
      billsFlaggedOverdueAmount: bt?.overdueAmount ?? 0,
      billsAgedOver90: agedOver90Rows[0]?.count ?? 0,
      billsAgedOver90Amount: agedOver90Rows[0]?.amount ?? 0,
      billsWithFollowUps: fu?.hasFollowUps ?? 0,
      promisesPassed: fu?.promisePassed ?? 0,
      billsNeedingAttention: needsAttentionRows[0]?.count ?? 0,
    },
    attentionBills,
    recentActivity: activityDocs.map((a) => ({
      id: String(a._id),
      action: a.action,
      module: a.module,
      userName: a.userName ?? "—",
      detail: a.detail ?? "",
      timestamp: new Date(a.timestamp),
    })),
  };
}
