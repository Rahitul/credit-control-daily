import { Schema, model, models, type Model, type Types } from "mongoose";
import { DEFAULT_CUSTOMER_GROUP } from "@/lib/types";

export { DEFAULT_CUSTOMER_GROUP } from "@/lib/types";

export type CustomerApprovalStatus = "pending" | "approved";

export interface ICustomer {
  _id: string;
  name: string;
  address?: string;
  contactPerson?: string;
  contactNumber?: string;
  category?: string;
  group: string;
  /**
   * Payment term in DAYS — customer must pay within this many days. OPTIONAL:
   * `null`/absent means no stored term, and the term DISPLAY falls through to
   * the Min/Max override, then the range derived from open bills. A stored 0
   * is display-skipped the same way (falls through); the sales overdue maths
   * keeps its own `?? 30` fallback for null and treats a real 0 as due the
   * same day.
   */
  creditLimitDays?: number | null;
  /**
   * Manual credit-term override, in days — the lower bound. `null`/absent OR
   * 0 means NO override: the term display derives the term live from this
   * party's open bills (`billDate → dueOn` gaps). A saved value (> 0) pins
   * the cell to the database, so pending-bill imports can no longer move it.
   */
  termMinDays?: number | null;
  /**
   * Upper bound of the manual override. `null`/absent/0 WITH `termMinDays`
   * set means a SINGLE number (both bounds equal); both `null` = automatic.
   */
  termMaxDays?: number | null;
  branch?: string;
  /** User ObjectId of the entering user — source of truth; name/role resolved from User at read time */
  createdBy?: Types.ObjectId;
  /** Legacy snapshot only (pre-lookup rows / deleted users) — do not write on new entries */
  createdByName?: string;
  /** Snapshot of the entering department role key (e.g. "sales") at entry time */
  createdByRole?: string;
  approvalStatus: CustomerApprovalStatus;
  approvedBy?: Types.ObjectId;
  approvedByName?: string;
  approvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const customerSchema = new Schema<ICustomer>(
  {
    name: { type: String, required: true, trim: true },
    address: { type: String, trim: true },
    contactPerson: { type: String, trim: true },
    contactNumber: { type: String, trim: true },
    category: { type: String, trim: true },
    group: { type: String, trim: true, default: DEFAULT_CUSTOMER_GROUP },
    creditLimitDays: { type: Number, min: 0, default: null },
    termMinDays: { type: Number, min: 0, default: null },
    termMaxDays: { type: Number, min: 0, default: null },
    branch: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    createdByName: { type: String, trim: true },
    createdByRole: { type: String, trim: true },
    approvalStatus: {
      type: String,
      enum: ["pending", "approved"],
      default: "pending",
      index: true,
    },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    approvedByName: { type: String, trim: true },
    approvedAt: { type: Date },
  },
  { timestamps: true }
);

export const Customer: Model<ICustomer> =
  models.Customer ?? model<ICustomer>("Customer", customerSchema);
