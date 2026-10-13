import { Schema, model, models, type Model, type Types } from "mongoose";
import { ROLES, type Role } from "@/lib/types";

/** Department apps a bill can be routed to. `admin` is never a route target. */
const ROUTABLE_ROLES = ROLES.filter((r): r is Role => r !== "admin");

export interface IPendingBill {
  _id: string;
  /** Col A — invoice / bill date */
  billDate: Date;
  /**
   * Col B — the whole composite string as typed, e.g. `TS-1854 dt.14.3.2026`.
   * Never normalised or rewritten; the export writes back exactly this value.
   */
  referenceNo: string;
  /**
   * Bill number parsed out of `referenceNo` (e.g. `TS-1854`) and persisted so it
   * is queryable/sortable. Recomputed from `referenceNo` on every write, so it
   * cannot drift. **Optional** because parsing never rejects: a reference with no
   * recognisable bill number still saves.
   */
  billNumber?: string;
    /**
     * Department app(s) this bill is routed to, derived from the bill-number prefix
     * by `departmentsFor()`: TS → consumable, CW → esbd, WO → eid, S → sales, plus
     * `branches` when the reference carries a branch prefix.
     * `[]` means "no match", which shows in Accounts only. Mongo matches array
     * members with `{ departments: "eid" }`, so a two-value array needs no `$or`.
     */
    departments: Role[];
    /**
     * The branch this bill belongs to, derived from `referenceNo` by
     * `matchBranch()` (see `lib/branches.ts`) on every write, exactly like
     * `departments`. `IOM/BOG/TS-040` matches branch prefix `BOG`.
     *
     * Optional, because parsing never rejects: a reference matching no branch
     * still saves. Stored so the branches app can filter to one branch without
     * re-deriving, and so a rename of the branch does not rewrite history —
     * `branchName` is the display snapshot, `branchId` the join.
     */
    branchId?: Types.ObjectId;
    /** Snapshot of the matched branch name at write time. */
    branchName?: string;
  /** Col C — party / customer / client name (free text, kept verbatim) */
  partyName: string;
  /**
   * The `Customer` this party resolves to, so a bill and a customer can be
   * joined later. Entering a bill (form or import) ENSURES a customer of that
   * name exists and stores its id here — see `lib/partyCustomers.ts`.
   *
   * **Optional**, not a ref-integrity requirement: `partyName` stays
   * authoritative and is always written, so a row whose customer creation failed
   * (or that predates the link) is still valid, just unlinked. Never make a
   * query depend on this field existing — join on `partyName` if you must match
   * legacy rows.
   */
  customerId?: Types.ObjectId;
  /** Col D — bill amount when opened */
  openingAmount: number;
  /** Col E — amount still unpaid / outstanding */
  pendingAmount: number;
  /** Col F — payment due date; blank means no term was set */
  dueOn?: Date;
  /**
   * Col G — number of days overdue, entered by the user.
   * 0 (or blank on the form) means "not yet due".
   */
  overdueDays: number;
  /**
   * Whole days from `billDate` to today — how old the bill is. Stored on write
   * (create/update/import) so it is queryable, and recomputed on read so the
   * number never goes stale overnight. Negative when the bill is dated ahead.
   */
  daysSinceBill: number;
  note?: string;
  followUps: {
    date: Date;
    note: string;
    /**
     * The payment date the customer promised on THIS call. Optional — many calls
     * end with no commitment at all, and the existing entries predate the field.
     */
    estimatedPaymentDate?: Date | null;
    createdBy?: Types.ObjectId;
    createdByRole?: string;
  }[];
  entryBy?: string;
  /** User ObjectId of the entering user — source of truth; name/role resolved from User at read time */
  createdBy?: Types.ObjectId;
  /** Snapshot of the entering department role key (e.g. "accounts") at entry time */
  createdByRole?: string;
  /**
   * The `User` this row is WORK-ALLOCATED to, set by Accounts/Admin distributing
   * the register (see `lib/nav.ts` `salesAssigneeClause`).
   *
   * Deliberately separate from `createdBy`: Entry By is an audit fact about who
   * typed the row and must survive reassignment, whereas this answers "whose desk
   * is it on". A bill entered by Accounts is unassigned here until somebody hands
   * it over, and a sales user sees ONLY rows whose `assignedTo` is them.
   *
   * Optional: only the sales app is allocation-scoped, and rows written before
   * this field existed have none.
   */
  assignedTo?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const pendingBillSchema = new Schema<IPendingBill>(
  {
    billDate: { type: Date, required: true, index: true },
    referenceNo: { type: String, required: true, trim: true, index: true },
    billNumber: { type: String, trim: true, index: true },
    departments: { type: [String], enum: ROUTABLE_ROLES, default: [] },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", index: true },
    branchName: { type: String, trim: true, index: true },
    partyName: { type: String, required: true, trim: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", index: true },
    openingAmount: { type: Number, required: true, min: 0 },
    pendingAmount: { type: Number, required: true, min: 0, index: true },
    dueOn: { type: Date, index: true },
    overdueDays: { type: Number, min: 0, default: 0, index: true },
    daysSinceBill: { type: Number, default: 0, index: true },
    note: { type: String, trim: true },
    followUps: [{
      date: { type: Date, default: Date.now },
      note: { type: String, trim: true, maxlength: 500 },
      estimatedPaymentDate: { type: Date, default: null },
      createdBy: { type: Schema.Types.ObjectId, ref: "User" },
      createdByRole: { type: String, trim: true },
    }],
    entryBy: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", index: true },
    createdByRole: { type: String, trim: true, index: true },
    assignedTo: { type: Schema.Types.ObjectId, ref: "User", index: true },
  },
  { timestamps: true }
);

/**
 * Col G (`overdueDays`) is a MANUAL entry, not derived from `dueOn` — the user types
 * the aging themselves, so the number only changes when someone edits the row.
 *
 * `billNumber` and `departments` are both DERIVED from `referenceNo` (see
 * `lib/pendingBills.ts`) and rewritten on every create/update, so editing a
 * reference like `TS-1854` → `S-1854` moves the row between apps rather than
 * forking it.
 *
 * `customerId` is likewise RE-RESOLVED from `partyName` on every write, so the
 * link follows the party even when a bill is edited to a different party.
 *
 * `assignedTo` is the one field on this model that is never derived and never
 * touched by a save — only Accounts/Admin redistribute it, or the backfill script
 * seeds it. A row save must therefore never $set it, or editing a bill would
 * silently take it off the assignee's desk.
 */
pendingBillSchema.index({ departments: 1, pendingAmount: 1 });
// Serves the sales-app list: department + allocation + open money in one pass.
pendingBillSchema.index({ departments: 1, assignedTo: 1, pendingAmount: 1 });
// Serves the branches-app list: department + one branch + open money in one pass.
pendingBillSchema.index({ departments: 1, branchId: 1, pendingAmount: 1 });

export const PendingBill: Model<IPendingBill> =
  models.PendingBill ?? model<IPendingBill>("PendingBill", pendingBillSchema);
