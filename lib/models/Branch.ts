import { Schema, model, models, type Model, type Types } from "mongoose";

/**
 * A branch office. `prefix` is the operational part: it is matched as a substring
 * anywhere in a bill reference to route the bill to the `branches` app — see
 * `matchBranch()` / `routeReference()` in `lib/branches.ts` / `lib/pendingBills.ts`.
 *
 * There is deliberately NO `department` field. A branch is an office, not a
 * department: which department app a bill belongs to is decided entirely by its
 * reference (`BILL_ROUTES` / `departmentsFor`), and a branch bill can additionally
 * land in a department app — `IOM/BOG/TS-040` is both a Bogura branch bill and a
 * Consumable-routed one. Storing a department here would be a second, competing
 * answer to a question the reference already answers.
 */
export interface IBranch {
  _id: string;
  /** Display name, e.g. `Bogura`. */
  name: string;
  /** Uppercase letters only, globally unique — the router matches on it. */
  prefix: string;
  /** An inactive branch is kept for its history but no longer routes anything. */
  active: boolean;
  note?: string;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const branchSchema = new Schema<IBranch>(
  {
    name: { type: String, required: true, trim: true, index: true },
    prefix: { type: String, required: true, trim: true, uppercase: true, index: true },
    active: { type: Boolean, default: true, index: true },
    note: { type: String, trim: true, maxlength: 300 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

/**
 * A prefix must be globally unique. Two branches sharing one would make routing
 * depend on the tie-break in `sortBranchPrefixes()` rather than on the data, and
 * there is no UI that could explain the resulting split.
 *
 * Deliberately NOT unique on `name`: two branches may legitimately share a display
 * name, and the *action* refuses a duplicate name case-insensitively so an
 * accidental duplicate cannot be typed in.
 */
branchSchema.index({ prefix: 1 }, { unique: true });

export const Branch: Model<IBranch> =
  models.Branch ?? model<IBranch>("Branch", branchSchema);
