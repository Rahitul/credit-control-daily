/**
 * SERVER-ONLY database half of the Pending Bills register. The pure helpers
 * (parsing, validation, the column map) live in `lib/pendingBills.ts`; this file
 * is what touches Mongoose, so the client form can import the former freely.
 *
 * `selectPendingBills` is shared by the list view and every export route, which
 * is what makes "Export" mean "download exactly what I am looking at" rather
 * than a second, drifting implementation of the same filters.
 */

import { db } from "@/lib/db";
import { PendingBill } from "@/lib/models/PendingBill";
import { Payment } from "@/lib/models/Payment";
import { User } from "@/lib/models/User";
import { Branch } from "@/lib/models/Branch";
import { Customer } from "@/lib/models/Customer";
import { ReferenceDepartmentMapping } from "@/lib/models/ReferenceDepartmentMapping";
import { toDateInput } from "@/lib/format";
import { DEPARTMENT_ROLES, isSalesAllocated, primaryRole, salesAssigneeClause, seesAllEntries } from "@/lib/nav";
import type { Role, SessionUser } from "@/lib/types";
import {
  billWarnings,
  creditTermDays,
  daysSinceBill,
  deriveFromReference,
  displayBillNumber,
  escapeRegex,
  extractBillNumber,
  partyTermDays,
  type WarnableBill,
} from "@/lib/pendingBills";

/**
 * May this user EDIT or DELETE this row?
 *
 * Two independent gates, and the row action and the `/…/[id]/edit` page are
 * reachable by a hand-typed id, so BOTH have to be re-checked on the write path.
 *
 * 1. **Department scope.** A department app only ever lists the bills routed to
 *    it, so a Consumable user must not be able to edit a Sales bill (or an
 *    Accounts-only unrouted one) without ever seeing it in a list. Accounts/Admin
 *    are unrestricted — that is the point of the consolidated view. A department
 *    user may write a bill routed to ANY department they hold a role for, so a
 *    user with both `sales` and `eid` can edit both lists they can see;
 *    `primaryRole` would wrongly lock them out of one of their own lists.
 *
 * 2. **Work allocation.** In the sales app a row belongs to whoever it was
 *    distributed to, so `assignedTo` must match. An UNASSIGNED row is not
 *    writable either: it is invisible in the user's list (see
 *    `salesAssigneeClause`), and letting them edit a row they cannot see would be
 *    the same hole one level up. The department check has already excluded every
 *    non-sales reader by this point.
 */
/**
 * Roles that write/read as an existing department role for row-scope checks.
 * `eid_juniors` is a read-only sidecar on the EID register (its list passes
 * `department="eid"`), so it must pass the same intersection test as an `eid`
 * user — otherwise `addFollowUp` would always fail the `canWriteBill` gate.
 */
const ROLE_EQUIV: Partial<Record<Role, Role>> = { eid_juniors: "eid" };

export function canWriteAllocatedRow(
  user: SessionUser | null,
  departments: readonly Role[] | null | undefined,
  assignedTo: unknown,
  billBranchId?: unknown
): boolean {
  if (!user) return false; // fail closed — an unknown session writes nothing
  if (seesAllEntries(user.roles)) {
    if (user.roles.includes("branches")) {
      if (!user.branchId) return false;
      return String(billBranchId ?? "") === String(user.branchId);
    }
    return true;
  }
  if (user.roles.includes("branches")) {
    if (!user.branchId) return false;
    return String(billBranchId ?? "") === String(user.branchId);
  }
  const mine = user.roles
    .map((r) => ROLE_EQUIV[r] ?? r)
    .filter((r) => DEPARTMENT_ROLES.includes(r));
  const routed = departments ?? [];
  if (!mine.some((r) => routed.includes(r))) return false;
  if (!isSalesAllocated(user.roles)) return true;
  if (!routed.includes("sales")) return true; // their EID/ESBD/Consumable rows
  return !!assignedTo && String(assignedTo) === user.id;
}

/** Gate for a `PendingBill`. Kept as its own name because the call sites read better. */
export function canWriteBill(
  user: SessionUser | null,
  departments: readonly Role[] | null | undefined,
  assignedTo: unknown = undefined,
  billBranchId?: unknown
): boolean {
  return canWriteAllocatedRow(user, departments, assignedTo, billBranchId);
}

/** Gate for a `Sale`. Identical rules — a sale is scoped by the same bill prefix. */
export function canWriteSale(
  user: SessionUser | null,
  departments: readonly Role[] | null | undefined,
  assignedTo: unknown = undefined,
  billBranchId?: unknown
): boolean {
  return canWriteAllocatedRow(user, departments, assignedTo, billBranchId);
}

export type PendingBillParams = Record<string, string | string[] | undefined>;

/**
 * Who is asking. Only `id` and `roles` are read, and only to decide the sales
 * work-allocation clause — never to widen anything. `null` means "no viewer",
 * which is treated as unrestricted; every real call site passes the session, and
 * the ones that can answer 403 do.
 */
export type BillViewer = { id: string; roles: Role[]; branchId?: string } | null;

function str(params: PendingBillParams, key: string): string {
  const v = params[key];
  return typeof v === "string" ? v : "";
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

/**
 * `department` scopes the query to one department app. `null` (Accounts/Admin)
 * means no routing filter at all, so the consolidated view keeps showing every
 * bill — routed or not. Unrouted bills carry `departments: []` and therefore
 * never match a department query, which is exactly their "Accounts only" rule.
 *
 * `completed` flips the register from outstanding to settled. It is NOT just a
 * reversed comparison: the `> 0` guard is what makes a paid bill leave the
 * Pending Bills list in the first place, so the same `completed` flag has to
 * drive the min/max merge below too — otherwise `?minPending=1000` on the
 * completed page would still be ANDed with `$gt: 0` and silently return nothing.
 *
 * `viewer` is the session, and it decides the sales work-allocation clause. It
 * is applied FIRST and is never overridable by a filter parameter, so no amount
 * of hand-typing `?party=` or `?route=` in the sales app can surface a row that
 * was not distributed to the reader.
 */
export function buildPendingBillQuery(
  params: PendingBillParams,
  department: Role | null,
  completed = false,
  viewer: BillViewer = null
): Record<string, unknown> {
  // A settled bill is `pendingAmount <= 0`: fully paid off, or written down to
  // nothing. Both are "no longer owed" and belong on the Completed list.
  const settledGuard = completed ? { $lte: 0 } : { $gt: 0 };
  const query: Record<string, unknown> = {
    pendingAmount: settledGuard,
  };

  if (department) {
    query.departments = department;
  }

  // Sales allocation. Spread first so no later `departments`/`route` branch can
  // be used as a lever to escape it.
  if (viewer) {
    const clause = salesAssigneeClause(viewer.roles, viewer.id, department);
    if (clause) Object.assign(query, clause);
    if (viewer.branchId && /^[0-9a-fA-F]{24}$/.test(viewer.branchId)) {
      query.branchId = viewer.branchId;
    } else if (viewer.branchId === null || viewer.branchId === "") {
      // no-op, do not force
    } else if (viewer.branchId) {
      // malformed ignored
    }
    if (viewer.roles.includes("branches")) {
      if (viewer.branchId && /^[0-9a-fA-F]{24}$/.test(viewer.branchId)) {
        query.branchId = viewer.branchId;
      } else {
        query.branchId = { $exists: false };
      }
      return query;
    }
  }

  const route = department ? "" : str(params, "route");
  if (route && route !== "unrouted") {
    query.departments = route;
  } else if (route === "unrouted") {
    // `$or` is a TOP-LEVEL operator — nesting it under a field is a server error
    // ("unknown operator: $or"). Covers rows written before `departments` existed.
    query.$or = [{ departments: { $size: 0 } }, { departments: { $exists: false } }];
  }

  const party = str(params, "party");
  if (party) query.partyName = party;

  /**
   * `branch` is the BRANCH OFFICE a bill belongs to, a fourth question distinct
   * from `route` (which department app it is filed in), `dept` (who typed it) and
   * `assigned` (whose desk it sits on).
   *
   * It is a real indexed field on `PendingBill`, so unlike `creditTerm` (which
   * is derived per row from `billDate`/`dueOn` after the fetch) it CAN be
   * expressed in Mongo. Guarded on hex24 for the
   * same reason as `assigned`: an unrecognised value must fall through to "no
   * filter" rather than match nothing and look like an empty register. Bills
   * written before branch routing existed carry no `branchId`, so they correctly
   * never appear under a branch — that is the honest answer, not a missing join.
   */
  const branch = str(params, "branch");
  if (branch === "unassigned") {
    query.branchId = null;
  } else if (/^[0-9a-fA-F]{24}$/.test(branch)) {
    query.branchId = branch;
  }

  // `dept` is the ENTRY department (who typed it). `route` above is where the
  // bill is ROUTED by its bill number. Two different things, two params.
  const dept = str(params, "dept");
  if (dept === "unknown") {
    query.createdByRole = { $in: [null, ""] };
  } else if (dept) {
    query.createdByRole = dept;
  }

  // `assigned` is the WORK-ALLOCATION filter, which is a third question distinct
  // from `route` (routing) and `dept` (entry). Only Accounts/Admin expose it.
  // `{ assignedTo: null }` is deliberate: in Mongo that matches a field that is
  // null AND a field that is absent, so legacy rows with no allocation are
  // collected by the same clause without an `$or` clashing with the one above.
  const assigned = str(params, "assigned");
  if (assigned === "unassigned") {
    query.assignedTo = null;
  } else if (/^[0-9a-fA-F]{24}$/.test(assigned)) {
    query.assignedTo = assigned;
  }

  const dateFrom = str(params, "dateFrom");
  const dateTo = str(params, "dateTo");
  if (dateFrom || dateTo) {
    const billDate: Record<string, Date> = {};
    const from = dayStart(dateFrom);
    const to = dayEnd(dateTo);
    if (from) billDate.$gte = from;
    if (to) billDate.$lte = to;
    query.billDate = billDate;
  }

  const dueFrom = str(params, "dueFrom");
  const dueTo = str(params, "dueTo");
  if (dueFrom || dueTo) {
    const dueOn: Record<string, Date> = {};
    const dFrom = dayStart(dueFrom);
    const dTo = dayEnd(dueTo);
    if (dFrom) dueOn.$gte = dFrom;
    if (dTo) dueOn.$lte = dTo;
    query.dueOn = dueOn;
  }

  const minPending = str(params, "minPending");
  const maxPending = str(params, "maxPending");
  if (minPending || maxPending) {
    // Merge into the settled guard — never overwrite it.
    const pending: Record<string, number> = completed
      ? { $lte: 0 }
      : { $gt: 0 };
    if (minPending) pending.$gte = Number(minPending);
    if (maxPending) pending.$lte = Number(maxPending);
    query.pendingAmount = pending;
  }

  // Col G is a manual figure, and a fully paid bill is by definition not owed any
  // more, so the overdue filter is meaningless on the completed list.
  if (!completed && str(params, "overdue") === "only") {
    query.overdueDays = { $gt: 0 };
  }

  // Bill age filter. `daysSinceBill` is stored on write, but it goes stale every
  // midnight — so the filter is expressed as a `billDate` window instead, which is
  // the same predicate evaluated against today's date and therefore always correct.
  // "At least N days old"  ⇔  billDate <= today - N.
  // "At most N days old"    ⇔  billDate >= today - N.
  const minDays = str(params, "minDays");
  const maxDays = str(params, "maxDays");
  if (minDays || maxDays) {
    const age: Record<string, Date> = {};
    const now = new Date();
    if (minDays) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - Number(minDays));
      age.$lte = d;
    }
    if (maxDays) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - Number(maxDays));
      age.$gte = d;
    }
    query.billDate = { ...(query.billDate as object), ...age };
  }

  // Bill YEAR filter. Expressed as a calendar-year window on `billDate` in
  // LOCAL time (the same clock the Date cell and the year dropdown use), and
  // intersected with any date/age bounds already set so `year` combined with
  // `dateFrom`/`minDays` can never fight: each bound keeps whichever side is
  // TIGHTER. Contradictory pairs (year 2025 + dateFrom in 2024) honestly
  // return nothing rather than silently widening.
  const yearParam = str(params, "year");
  if (/^\d{4}$/.test(yearParam)) {
    const y = Number(yearParam);
    const win = {
      $gte: new Date(y, 0, 1),
      $lte: new Date(y, 11, 31, 23, 59, 59, 999),
    };
    const existing = (query.billDate ?? {}) as { $gte?: Date; $lte?: Date };
    const gte =
      existing.$gte && existing.$gte.getTime() > win.$gte.getTime() ? existing.$gte : win.$gte;
    const lte =
      existing.$lte && existing.$lte.getTime() < win.$lte.getTime() ? existing.$lte : win.$lte;
    query.billDate = { ...existing, $gte: gte, $lte: lte };
  }

  return query;
}

const SORT_MAP: Record<string, Record<string, 1 | -1>> = {
  dateDesc: { billDate: -1, createdAt: -1 },
  dateAsc: { billDate: 1, createdAt: 1 },
  dueAsc: { dueTs: 1, billDate: 1 },
  dueDesc: { dueTsRev: 1, billDate: 1 },
  pendingDesc: { pendingAmount: -1 },
  pendingAsc: { pendingAmount: 1 },
  openingDesc: { openingAmount: -1 },
  openingAsc: { openingAmount: 1 },
  overdueDesc: { overdueDays: -1, dueTs: 1 },
  ageDesc: { daysSinceBill: -1, billDate: 1 },
  ageAsc: { daysSinceBill: 1, billDate: 1 },
  partyAsc: { partyName: 1, billDate: 1 },
  refAsc: { referenceNo: 1, billDate: 1 },
  billNoAsc: { billNumber: 1, billDate: 1 },
  billNoDesc: { billNumber: -1, billDate: -1 },
  // Completed-list sorts: the question changes from "who owes" to "what closed
  // and when", so recency is the useful default rather than bill date.
  completedDesc: { settledOn: -1, billDate: -1 },
  completedAsc: { settledOn: 1, billDate: 1 },
  openingDescCompleted: { openingAmount: -1, billDate: -1 },
};

export const PENDING_BILL_SORTS = Object.keys(SORT_MAP);

const NO_DUE = Number.MAX_SAFE_INTEGER;

export type PendingBillRow = {
  id: string;
  billDate: Date;
  referenceNo: string;
  billNumber: string;
  partyName: string;
  openingAmount: number;
  pendingAmount: number;
  dueOn: Date | null;
  overdueDays: number;
  /** Bill age in days, recomputed from `billDate` on every read. */
  daysSinceBill: number;
  note: string;
  followUps: {
    date: Date;
    note: string;
    estimatedPaymentDate: Date | null;
    createdBy: string;
    createdByRole: string;
    creatorName: string;
  }[];
  followUpCount: number;
  lastFollowUpDate: Date | null;
  /**
   * The promise currently on the table: the `estimatedPaymentDate` of the most
   * RECENT follow-up that carried one. Not simply the last entry's value — a
   * later call often ends with "no date given", and blanking the column then
   * would hide a promise the customer is still being held to. `null` when no
   * follow-up has ever named a date.
   */
  lastPromisedDate: Date | null;
  /** True when `lastPromisedDate` is behind us. Derived server-side, never in render. */
  promisedPassed: boolean;
  /**
   * The bill's credit TERM in days: the gap from `billDate` to `dueOn`,
   * computed by `creditTermDays` on every read. `null` when the bill carries no
   * due date — there is no term to count, so the cell renders "—".
   */
  creditLimitDays: number | null;
  /**
   * The PARTY's credit term for the Credit Term column — the stored Credit
   * Limit (Days) (> 0) → Min/Max override (`termMinDays` > 0), resolved by
   * `partyTermDays` with NO derived-range input (unlike the Customers list,
   * which falls back to the party's open-bill range). `null` when the party
   * has no customer record or no stored term — the cell then falls back to
   * THIS bill's own per-bill gap above, i.e. the column shows the bill's
   * individual term. The Credit Term FILTER keeps using that per-bill field,
   * unchanged.
   */
  partyTerm: { min: number; max: number } | null;
  entryBy: string;
  createdByRole: string;
  /** Hex id of the user this row is work-allocated to, or "" when unassigned. */
  assignedTo: string;
  /** Resolved from `User` by `assignedTo`; "" when unassigned or the user is gone. */
  assigneeName: string;
  departments: Role[];
  /**
   * The branch office this bill was routed to, as a WRITE-TIME SNAPSHOT of
   * `Branch.name`. Deliberately the name and not a live join: a branch that is
   * renamed or deactivated must not rewrite what these bills say they are, the
   * same way `createdByRole` is a snapshot of the entering department. `""` on
   * rows written before branch routing existed.
   */
  branchName: string;
  warnings: string[];
  creatorName: string;
  creatorRole: string;
  dueTs: number;
  dueTsRev: number;
  /**
   * Money already applied to this bill, and when. Only populated on the
   * Completed list, where it is the whole point of the page; it is read from
   * `Payment.settlements`, the ledger written by `allocatePayment`, so it can
   * never disagree with the arithmetic that reduced `pendingAmount`.
   */
  settledAmount: number;
  settledBy: string;
  settledOn: string;
};

export type BranchOption = { id: string; name: string };

export type PendingBillSelection = {
  rows: PendingBillRow[];
  /** Distinct party names, for the filter dropdown. Never department-scoped. */
  partyOptions: string[];
  /** Distinct entry departments, for the filter dropdown. */
  entryDeptOptions: string[];
  /**
   * Distinct credit terms, in days, across the outstanding register — each
   * bill's own `billDate → dueOn` gap. Sourced from the same computation the
   * column uses, and independent of the active filters so the dropdown never
   * collapses to the value you just picked.
   */
  creditTermOptions: number[];
  /**
   * Distinct years present in the bills register (newest first), for the Bill
   * Year dropdown. Sourced from the whole register rather than the filtered
   * rows for the same reason as the other option lists: picking a year must not
   * make every other option disappear.
   */
  yearOptions: number[];
  /**
   * Branch offices present in the outstanding register, as id/name pairs, for the
   * filter dropdown. Sourced from the whole register rather than the filtered rows
   * for the same reason as the party and credit-term dropdowns: picking a value
   * must not make every other option disappear.
   *
   * `name` is the branch's CURRENT name, so a rename relabels the dropdown, while
   * the table column shows the snapshot the bill was written with. The id is the
   * stable key: grouping by it is correct across a rename even though the two
   * labels can differ.
   */
  branchOptions: BranchOption[];
};

export async function selectPendingBills(
  params: PendingBillParams,
  department: Role | null = null,
  completed = false,
  viewer: BillViewer = null
): Promise<PendingBillSelection> {
  await db();

  const query = buildPendingBillQuery(params, department, completed, viewer);
  const q = str(params, "q");
  const warnOnly = str(params, "warn") === "only";
  const sort = str(params, "sort") || (completed ? "completedDesc" : "dateDesc");
  // Promised-date filters are applied in JS, not in the Mongo query: they ask
  // about the ETA of the MOST RECENT follow-up that carried one, and Mongo
  // cannot index or match "the last element of an array" — a `$elemMatch` on
  // `followUps.estimatedPaymentDate` would match an older, superseded promise.
  const promise = str(params, "promise");
  const promiseFrom = dayStart(str(params, "promiseFrom"));
  const promiseTo = dayEnd(str(params, "promiseTo"));
  // One `startOfToday` for the whole selection: the per-row `promisedPassed`
  // flag and the `promise` filter must not disagree, and both are compared
  // against local midnight so a promise is "passed" for the whole of its day.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  // The party dropdown is populated from OUTSTANDING bills on both pages: it is a
  // "filter by party" control, and listing every party who ever had a completed
  // bill would swamp it. On the completed page a party with no outstanding bills
  // can still be typed into `?party=`.
  const [docs, partyList, entryDeptList, branchIds, billDates] = await Promise.all([
    PendingBill.find(query).limit(500).lean().exec(),
    PendingBill.distinct("partyName", { pendingAmount: { $gt: 0 } }),
    PendingBill.distinct("createdByRole", {
      createdByRole: { $exists: true, $ne: null },
    }),
    PendingBill.distinct("branchId", {
      branchId: { $exists: true, $ne: null },
      pendingAmount: { $gt: 0 },
    }),
    // Bill-year dropdown: every distinct bill date in the register, collapsed
    // to years below in JS (LOCAL year, exactly how the query window and the
    // Date cell interpret them — a `$year` aggregation would use UTC and could
    // disagree by a day around New Year).
    PendingBill.distinct("billDate", {}),
  ]);

  // One join for the branch dropdown, keyed on the ids the register actually
  // references. A branch deleted out from under its bills simply contributes no
  // option — the bills still carry their `branchName` snapshot in the column.
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
  const branchOptions: BranchOption[] = branchDocs.map((b) => ({
    id: String(b._id),
    name: b.name,
  }));

  // Resolve the entering user from the users collection by `createdBy` ObjectId.
  // Values may be a real ObjectId or a legacy hex string → normalize with String()
  // first; non-hex garbage is dropped so User.find can't throw a CastError.
  // `assignedTo` ids are folded into the same batch: both resolve against
  // `User`, so one query serves both columns instead of two.
  const creatorIds = [
    ...new Set(
      docs
        .flatMap((b) => [b.createdBy, b.assignedTo])
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

  // Resolve follow-up creators — same batched pattern as the entering user.
  const followUpUserIds = [
    ...new Set(
      docs.flatMap((b) =>
        (b.followUps ?? [])
          .map((f) => (f.createdBy ? String(f.createdBy) : ""))
          .filter((v) => /^[0-9a-fA-F]{24}$/.test(v))
      )
    ),
  ];
  const followUpUsers = followUpUserIds.length
    ? await User.find({ _id: { $in: followUpUserIds } })
        .select({ name: 1, role: 1 })
        .lean()
        .exec()
    : [];
  const followUpUserById = new Map(followUpUsers.map((u) => [String(u._id), u]));

  // The PARTY term for the Credit Term column: stored Credit Limit (Days) →
  // Min/Max override — resolved by `partyTermDays`. Deliberately NO derived
  // range here: when the customer record carries neither stored value (or has
  // no record at all), `partyTerm` comes back `null` and the cell falls back
  // to THIS bill's own per-bill gap, so each bill shows its individual term
  // (the Customers list, which has no single-bill context, still derives the
  // party range — see `partyTermDays`). Linked rows resolve by `customerId`;
  // legacy unlinked rows fall back to a CASE-INSENSITIVE whole-name match,
  // the same linking rule `lib/credit.ts` uses. The Credit Term FILTER is
  // untouched and keeps filtering on each bill's own per-bill
  // `creditLimitDays` field.
  const termCustIds = [
    ...new Set(
      docs
        .map((b) => (b.customerId ? String(b.customerId) : ""))
        .filter((v) => /^[0-9a-fA-F]{24}$/.test(v))
    ),
  ];
  const termNames = [
    ...new Set(
      docs
        .map((b) => String(b.partyName ?? "").trim())
        .filter((v) => v.length > 0)
    ),
  ];
  const termNameRegex = termNames.length
    ? new RegExp(`^(?:${termNames.map(escapeRegex).join("|")})$`, "i")
    : null;
  const termCustomers =
    termCustIds.length || termNameRegex
      ? await Customer.find({
          $or: [
            ...(termCustIds.length ? [{ _id: { $in: termCustIds } }] : []),
            ...(termNameRegex ? [{ name: termNameRegex }] : []),
          ],
        })
          .select({ name: 1, creditLimitDays: 1, termMinDays: 1, termMaxDays: 1 })
          .lean()
          .exec()
      : [];
  const termCustById = new Map(termCustomers.map((c) => [String(c._id), c]));
  const termCustByLowerName = new Map(
    termCustomers.map((c) => [String(c.name ?? "").trim().toLowerCase(), c])
  );

  // Which payments settled these bills, and when. One batched query over the
  // `settlements.billId` ledger rather than a lookup per row, and only on the
  // completed page where it is displayed.
  const settledByBill = new Map<
    string,
    { amount: number; by: string; on: string }
  >();
  if (completed && docs.length) {
    const billIds = docs.map((b) => String(b._id));
    const settledPayments = await Payment.find({
      approvalStatus: "approved",
      "settlements.billId": { $in: billIds },
    })
      .select({ settlements: 1, approvedAt: 1, rcvDate: 1, entryBy: 1 })
      .lean()
      .exec();

    for (const pay of settledPayments) {
      const on = toDateInput(pay.approvedAt ?? pay.rcvDate);
      const by = pay.entryBy ?? "";
      for (const s of pay.settlements ?? []) {
        const key = String(s.billId);
        const prev = settledByBill.get(key);
        const amount = (prev?.amount ?? 0) + (s.amount ?? 0);
        // A bill can be settled across several payments; show the first date and
        // the sum, which is the only combination that cannot be misleading.
        const firstOn = prev ? (prev.on < on ? prev.on : on) : on;
        settledByBill.set(key, { amount, by: prev?.by ?? by, on: firstOn });
      }
    }
  }

  // Col G is the user's own manual `overdueDays` figure — the stored value is the
  // single source of truth for the cell, the `overdue=only` filter, the
  // `overdueDesc` sort and the header count, so they can never disagree.
  // `dueTs`/`dueTsRev` keep undated bills at the bottom for BOTH due directions,
  // which the generic comparator below cannot express.
  let rows: PendingBillRow[] = docs.map((b) => {
    const creator = b.createdBy ? creatorById.get(String(b.createdBy)) : undefined;
    const departments = b.departments?.length
      ? b.departments
      : deriveFromReference(b.referenceNo).departments;

    // This party's term for the Credit Term column — see the batch above.
    // No derived-range input on purpose: `partyTerm` is null unless the
    // customer record carries a stored creditLimitDays (> 0) or a Min/Max
    // override (termMinDays > 0); the row then renders its own per-bill gap.
    const lowerParty = String(b.partyName ?? "").trim().toLowerCase();
    const termCust =
      (b.customerId ? termCustById.get(String(b.customerId)) : undefined) ??
      termCustByLowerName.get(lowerParty);
    const partyTerm = termCust
      ? partyTermDays({
          creditLimitDays: termCust.creditLimitDays ?? null,
          termMinDays: termCust.termMinDays ?? null,
          termMaxDays: termCust.termMaxDays ?? null,
        })
      : null;

    // The promise currently on the table: the ETA from the most recent follow-up
    // that carried one. Walking newest → oldest rather than reading only the last
    // entry means a later "no date given" call does not blank out a promise the
    // customer is still being held to.
    const fuList = b.followUps ?? [];
    let promised: Date | null = null;
    for (let i = fuList.length - 1; i >= 0; i -= 1) {
      const eta = fuList[i].estimatedPaymentDate;
      if (eta) {
        promised = new Date(eta);
        break;
      }
    }

    return {
      id: String(b._id),
      billDate: b.billDate,
      referenceNo: b.referenceNo,
      billNumber: displayBillNumber(b),
      partyName: b.partyName,
      openingAmount: b.openingAmount,
      pendingAmount: b.pendingAmount,
      dueOn: b.dueOn ? new Date(b.dueOn) : null,
      overdueDays: b.overdueDays ?? 0,
      // Recomputed, not read back: the stored value is a write-time snapshot and
      // would otherwise freeze at whatever day the bill was entered.
      daysSinceBill: daysSinceBill(b.billDate, b.dueOn, b.overdueDays),
      note: b.note ?? "",
      followUps: (b.followUps ?? []).map((f) => ({
        date: f.date,
        note: f.note,
        estimatedPaymentDate: f.estimatedPaymentDate ? new Date(f.estimatedPaymentDate) : null,
        createdBy: f.createdBy ? String(f.createdBy) : "",
        createdByRole: f.createdByRole ?? "",
        creatorName: f.createdBy ? (followUpUserById.get(String(f.createdBy))?.name ?? "") : "",
      })),
      followUpCount: b.followUps?.length ?? 0,
      lastFollowUpDate: b.followUps?.length
        ? b.followUps[b.followUps.length - 1].date
        : null,
      // Walk newest → oldest and take the first entry that named a date. Entries
      // written before this field existed simply have none, so the loop is the
      // only thing that can answer "what is the live promise".
      lastPromisedDate: promised,
      // Derived here, not in the client cell: the row is SSR'd and then hydrated,
      // so a `new Date()` evaluated during render can disagree with the server's
      // answer at a midnight boundary and trip a hydration mismatch. Same reason
      // `daysSinceBill` lives in the data layer.
      promisedPassed: promised !== null && promised.getTime() < startOfToday.getTime(),
      // Recomputed from the bill's own dates on every read — never joined from
      // Customer: two bills of the same party can legitimately carry different
      // terms, and this cell answers "how long did THIS bill get". The Credit
      // Term COLUMN prefers `partyTerm` (the party's term) and only falls back
      // to this per-bill figure when the party has none; the term FILTER keeps
      // reading this field alone.
      creditLimitDays: creditTermDays(b.billDate, b.dueOn),
      partyTerm,
      entryBy: b.entryBy ?? "",
      createdByRole: b.createdByRole ?? "",
      assignedTo: b.assignedTo ? String(b.assignedTo) : "",
      assigneeName: b.assignedTo
        ? (creatorById.get(String(b.assignedTo))?.name ?? "")
        : "",
      departments,
      branchName: b.branchName ?? "",
      warnings: billWarnings({
        referenceNo: b.referenceNo,
        billDate: b.billDate,
        departments,
      } as WarnableBill),
      creatorName: creator?.name ?? "",
      creatorRole: b.createdByRole ?? (creator ? primaryRole(creator.role) : ""),
      dueTs: b.dueOn ? new Date(b.dueOn).getTime() : NO_DUE,
      dueTsRev: b.dueOn ? -new Date(b.dueOn).getTime() : NO_DUE,
      settledAmount: settledByBill.get(String(b._id))?.amount ?? 0,
      settledBy: settledByBill.get(String(b._id))?.by ?? "",
      settledOn: settledByBill.get(String(b._id))?.on ?? "",
    };
  });

  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter((b) =>
      [
        b.referenceNo,
        b.billNumber,
        b.partyName,
        b.note,
        b.entryBy,
        b.creatorName,
        b.assigneeName,
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }

  // Credit term is computed per row from `billDate`/`dueOn`, which are already
  // on the fetched doc — but a term filter on the pair cannot become a clean
  // Mongo predicate without breaking the age/date windows, so it stays a JS
  // post-filter like the promised-date filters. `unknown` collects the bills
  // with no due date, which is a question worth being able to ask (they are
  // exactly the rows the term column renders as "—").
  const creditTerm = str(params, "creditTerm");
  if (creditTerm) {
    rows = rows.filter((b) =>
      creditTerm === "unknown"
        ? b.creditLimitDays === null
        : b.creditLimitDays === Number(creditTerm)
    );
  }

  if (warnOnly) {
    rows = rows.filter((b) => b.warnings.length > 0);
  }

  if (promise) {
    rows = rows.filter((b) => {
      if (!b.lastPromisedDate) return promise === "none";
      return promise === "passed" ? b.promisedPassed : promise === "upcoming" ? !b.promisedPassed : true;
    });
  }

  if (promiseFrom || promiseTo) {
    rows = rows.filter((b) => {
      if (!b.lastPromisedDate) return false;
      const t = b.lastPromisedDate.getTime();
      if (promiseFrom && t < promiseFrom.getTime()) return false;
      if (promiseTo && t > promiseTo.getTime()) return false;
      return true;
    });
  }

  const sortSpec = SORT_MAP[sort] ?? SORT_MAP.dateDesc;
  rows = [...rows].sort((a, b) => {
    for (const [key, dir] of Object.entries(sortSpec)) {
      const av = (a as unknown as Record<string, unknown>)[key];
      const bv = (b as unknown as Record<string, unknown>)[key];
      let cmp = 0;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av ?? "").localeCompare(String(bv ?? ""));
      if (cmp !== 0) return dir === 1 ? cmp : -cmp;
    }
    return 0;
  });

  // The dropdown lists the terms of the WHOLE outstanding register, not of the
  // rows that survived the current filters — otherwise picking a term would make
  // every other option disappear, and the control could not be changed back
  // without a page reload. Same reasoning as the party dropdown. Terms come
  // from the bills themselves (`dueOn - billDate`), so the grouping is on the
  // DATE PAIR: registers reuse the same handful of bill/due dates across many
  // rows, which collapses the aggregation to a few dozen pairs in practice.
  const termOptionSet = new Set<number>();
  const termPairs = await PendingBill.aggregate<{ _id: { b: Date; d: Date | null } }>([
    { $match: { pendingAmount: { $gt: 0 } } },
    { $group: { _id: { b: "$billDate", d: "$dueOn" } } },
  ]).exec();
  for (const pair of termPairs) {
    const term = creditTermDays(pair._id.b, pair._id.d);
    if (term !== null) termOptionSet.add(term);
  }

  const yearOptionSet = new Set<number>();
  for (const d of billDates as unknown[]) {
    const date = new Date(d as string | number | Date);
    if (!Number.isNaN(date.getTime())) yearOptionSet.add(date.getFullYear());
  }

  return {
    rows,
    partyOptions: [...partyList].filter((v): v is string => !!v).sort(),
    entryDeptOptions: [...entryDeptList].filter((v): v is string => !!v).sort(),
    creditTermOptions: [...termOptionSet].sort((a, b) => a - b),
    yearOptions: [...yearOptionSet].sort((a, b) => b - a),
    branchOptions,
  };
}

/* ------------------------------------------------------------------ */
/* Reference Department Mapping — Server-side only                     */
/* ------------------------------------------------------------------ */

export type DepartmentMappingResult = {
  departments: Role[];
  source: "mapping" | "auto";
  billNumber: string;
};

/**
 * Resolve departments for a reference number, checking the mapping database first.
 * Falls back to auto-detection if no mapping exists.
 */
export async function resolveDepartmentsFromMapping(
  referenceNo: string,
  branches: readonly { id: string; name: string; prefix: string }[],
  userId: string
): Promise<DepartmentMappingResult> {
  const billNumber = extractBillNumber(referenceNo) ?? referenceNo.trim();

  // Try to find existing mapping
  const mapping = await ReferenceDepartmentMapping.findOne({
    billNumberPattern: billNumber.toUpperCase(),
  }).lean().exec();

  if (mapping) {
    // Increment usage count
    await ReferenceDepartmentMapping.updateOne(
      { _id: mapping._id },
      { $inc: { matchedCount: 1 }, $set: { lastUsedAt: new Date() } }
    ).exec();

    return {
      departments: mapping.departments,
      source: mapping.isManual ? "mapping" : "auto",
      billNumber,
    };
  }

  // No mapping exists — fall back to auto-detection
  const { routeReference } = await import("@/lib/pendingBills");
  const routed = routeReference(referenceNo, branches);

  // Create initial auto mapping for future use
  if (routed.departments.length > 0) {
    await ReferenceDepartmentMapping.create({
      billNumberPattern: billNumber.toUpperCase(),
      departments: routed.departments,
      matchedCount: 1,
      lastUsedAt: new Date(),
      createdBy: userId,
      isManual: false,
    });
  }

  return {
    departments: routed.departments,
    source: "auto",
    billNumber,
  };
}

/**
 * Upsert a department mapping (create or update).
 * Called when a user manually overrides the department.
 */
export async function upsertDepartmentMapping(
  billNumberPattern: string,
  departments: Role[],
  userId: string,
  isManual: boolean
): Promise<void> {
  const pattern = billNumberPattern.trim().toUpperCase();
  if (!pattern || departments.length === 0) return;

  await ReferenceDepartmentMapping.findOneAndUpdate(
    { billNumberPattern: pattern },
    {
      $set: {
        departments,
        isManual,
        lastUsedAt: new Date(),
      },
      $inc: { matchedCount: 1 },
      $setOnInsert: {
        createdBy: userId,
      },
    },
    { upsert: true, new: true }
  ).exec();
}

/**
 * Get all mappings for a user (for potential admin UI).
 */
export async function getUserMappings(userId: string) {
  return ReferenceDepartmentMapping.find({ createdBy: userId })
    .sort({ createdAt: -1 })
    .lean()
    .exec();
}
