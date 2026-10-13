import { Schema, model, models, type Model, type Types } from "mongoose";
import { ROLES, type Role } from "@/lib/types";

const ROUTABLE_ROLES = ROLES.filter((r): r is Role => r !== "admin");

export interface IReferenceDepartmentMapping {
  _id: string;
  billNumberPattern: string;
  departments: Role[];
  matchedCount: number;
  lastUsedAt: Date;
  createdBy: Types.ObjectId;
  isManual: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const referenceDepartmentMappingSchema = new Schema<IReferenceDepartmentMapping>(
  {
    billNumberPattern: { type: String, required: true, trim: true, unique: true, index: true },
    departments: { type: [String], enum: ROUTABLE_ROLES, required: true },
    matchedCount: { type: Number, default: 0, min: 0 },
    lastUsedAt: { type: Date, default: Date.now, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    isManual: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

referenceDepartmentMappingSchema.index({ createdBy: 1, createdAt: -1 });

export const ReferenceDepartmentMapping: Model<IReferenceDepartmentMapping> =
  models.ReferenceDepartmentMapping ?? model<IReferenceDepartmentMapping>("ReferenceDepartmentMapping", referenceDepartmentMappingSchema);