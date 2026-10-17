import { Schema, model, models, type Model, type Types } from "mongoose";

/**
 * A user's payment-collection target for one calendar month, split into the
 * month's four fixed weeks (see `weekRange()` in `lib/collectionTargets.ts`).
 *
 * One document per `{ userId, year, month }` — the unique index below is the
 * real guard, and the action upserts against it rather than inserting a second
 * row for the same user and month.
 *
 * `weeks` is always length 4, `[w1, w2, w3, w4]`, each a non-negative ৳ amount.
 * Progress against these figures is derived at read time from approved payments
 * (`Payment.rcvDate`), never stored here.
 */
export interface ICollectionTarget {
  _id: string;
  userId: Types.ObjectId;
  year: number;
  month: number;
  weeks: number[];
  createdBy?: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const collectionTargetSchema = new Schema<ICollectionTarget>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    year: { type: Number, required: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    weeks: { type: [Number], default: [0, 0, 0, 0] },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

collectionTargetSchema.index({ userId: 1, year: 1, month: 1 }, { unique: true });

export const CollectionTarget: Model<ICollectionTarget> =
  models.CollectionTarget ??
  model<ICollectionTarget>("CollectionTarget", collectionTargetSchema);
