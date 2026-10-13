import { Schema, model, models, type Model, type Types } from "mongoose";
import { ROLES, type Role } from "@/lib/types";

const ROUTABLE_ROLES = ROLES.filter((r): r is Role => r !== "admin");

export interface ISale {
  _id: string;
  referenceId: string;
  customerId: Types.ObjectId;
  saleDate: Date;
  amount: number;
  billNo: string;
  billDate: Date;
  /** Department app(s) this sale is routed to, derived from billNo prefix */
  departments: Role[];
  /**
   * The branch this sale belongs to, derived from the bill reference by
   * `matchBranch()` (see `lib/branches.ts`) on every write, exactly like
   * `departments`. Optional — a reference matching no branch still saves.
   * `branchName` is the display snapshot, `branchId` the join.
   */
  branchId?: Types.ObjectId;
  /** Snapshot of the matched branch name at write time. */
  branchName?: string;
  entryBy?: string;
  /** User ObjectId of the entering user — source of truth; name/role resolved from User at read time */
  createdBy?: Types.ObjectId;
  /** Snapshot of the entering department role key (e.g. "sales") at entry time */
  createdByRole?: string;
  /**
   * The `User` this sale is WORK-ALLOCATED to, set by Accounts/Admin distributing
   * the register. Same contract as `PendingBill.assignedTo`: separate from
   * `createdBy` so the Entry By audit trail survives reassignment, optional, and
   * never written by a sale save.
   */
  assignedTo?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const saleSchema = new Schema<ISale>(
  {
    referenceId: { type: String, required: true, unique: true, index: true },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },
    saleDate: { type: Date, required: true },
    amount: { type: Number, required: true, min: 0.01 },
    billNo: { type: String, required: true, trim: true, index: true },
    billDate: { type: Date, required: true },
    departments: { type: [String], enum: ROUTABLE_ROLES, default: [], index: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", index: true },
    branchName: { type: String, trim: true, index: true },
    entryBy: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", index: true },
    createdByRole: { type: String, trim: true, index: true },
    assignedTo: { type: Schema.Types.ObjectId, ref: "User", index: true },
  },
  { timestamps: true }
);

// Serves the sales-app list: department + allocation + recency in one pass.
saleSchema.index({ departments: 1, assignedTo: 1, saleDate: -1 });
// Serves the branches-app list: department + one branch + recency in one pass.
saleSchema.index({ departments: 1, branchId: 1, saleDate: -1 });

export const Sale: Model<ISale> = models.Sale ?? model<ISale>("Sale", saleSchema);
