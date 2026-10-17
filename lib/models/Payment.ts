import { Schema, model, models, type Model, type Types } from "mongoose";

/**
 * A payment is `pending` from the moment it is entered and only becomes
 * `approved` once Accounts/Admin has checked it. ONLY approved payments reduce a
 * pending bill's `pendingAmount` — a `pending` payment is a claim, not a
 * settlement, so it must not move any outstanding/overdue figure.
 *
 * `allocating` is a transient claim state, not a status a user sets. It exists
 * because this app runs on a standalone mongod (no multi-document transactions),
 * so approval is written as claim -> plan -> apply -> approve. The plan is
 * persisted *before* the bills are touched, so a crash mid-approval leaves a
 * payment that a retry can finish without re-deducting.
 */
export type PaymentApprovalStatus = "pending" | "allocating" | "approved";

/** One bill this payment reduced, and by how much. An audit ledger, never edited. */
export interface IPaymentSettlement {
  billId: Types.ObjectId;
  billNumber: string;
  referenceNo: string;
  amount: number;
}

export interface IPayment {
  _id: string;
  rcvDate: Date;
  customerId: Types.ObjectId;
  branch?: string;
  billCategory?: string;
  billNo?: string;
  billDate?: Date;
  paymentType: string;
  /** True when the payment was received as a discounted settlement. */
  isDiscounted?: boolean;
  /** True when VAT applied to this payment. */
  isVat?: boolean;
  /** True when Tax/AIT applied to this payment. */
  isTaxAit?: boolean;
  rcvAmount: number;
  bankType?: string;
  bankName?: string;
  assignedPerson?: string;
  /** Free-hand remarks/note entered with the payment — display only. */
  remarks?: string;
  entryBy?: string;
  /** User ObjectId of the entering user — source of truth; name/role resolved from User at read time */
  createdBy?: Types.ObjectId;
  /** Snapshot of the entering department role key (e.g. "sales") at entry time */
  createdByRole?: string;
  relatedSaleReferenceId?: string;
  approvalStatus: PaymentApprovalStatus;
  approvedBy?: Types.ObjectId;
  approvedByRole?: string;
  approvedAt?: Date;
  /** How much of `rcvAmount` actually came off pending bills. */
  allocatedAmount?: number;
  /**
   * The remainder that matched no outstanding bill. Kept (never discarded) so the
   * money is traceable: an approved payment that settled nothing still records why.
   */
  unallocatedAmount?: number;
  settlements?: IPaymentSettlement[];
  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = new Schema<IPayment>(
  {
    rcvDate: { type: Date, required: true },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },
    branch: { type: String, trim: true },
    billCategory: { type: String, trim: true },
    billNo: { type: String, trim: true },
    billDate: { type: Date },
    paymentType: { type: String, required: true },
    isDiscounted: { type: Boolean, default: false, index: true },
    isVat: { type: Boolean, default: false, index: true },
    isTaxAit: { type: Boolean, default: false, index: true },
    rcvAmount: { type: Number, required: true, min: 0.01 },
    bankType: { type: String, trim: true },
    bankName: { type: String, trim: true },
    assignedPerson: { type: String, trim: true },
    remarks: { type: String, trim: true },
    entryBy: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", index: true },
    createdByRole: { type: String, trim: true, index: true },
    relatedSaleReferenceId: { type: String, trim: true, index: true },

    approvalStatus: {
      type: String,
      enum: ["pending", "allocating", "approved"],
      default: "pending",
      index: true,
    },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User", index: true },
    approvedByRole: { type: String, trim: true },
    approvedAt: { type: Date },
    allocatedAmount: { type: Number, default: 0 },
    unallocatedAmount: { type: Number, default: 0 },
    settlements: {
      type: [
        new Schema<IPaymentSettlement>(
          {
            billId: { type: Schema.Types.ObjectId, ref: "PendingBill" },
            billNumber: { type: String, trim: true },
            referenceNo: { type: String, trim: true },
            amount: { type: Number, required: true },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
  },
  { timestamps: true }
);

export const Payment: Model<IPayment> =
  models.Payment ?? model<IPayment>("Payment", paymentSchema);
