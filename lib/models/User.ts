import { Schema, model, models, type Model, type Types } from "mongoose";
import { ROLES, type Role } from "@/lib/types";

export interface IUser {
  _id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: Role[];
  department?: string;
  branchId?: Types.ObjectId;
  status: "active" | "inactive";
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: {
      type: [{ type: String, enum: ROLES }],
      required: true,
      validate: [(v: Role[]) => v.length > 0, "At least one role is required"],
    },
    department: { type: String },
    /**
     * The branch this user works at, assigned by Admin on the Users & Roles page.
     * Defaults the branches-app lists to that branch (still overridable to "All
     * branches"), and names the branch in the users table.
     *
     * Optional and a plain ref, NOT a `ref`-integrity requirement: a user can hold
     * no branch, and a branch can be deleted once no bill or sale references it, so
     * read paths must treat a missing or dangling link as "no branch" rather than
     * failing. A deleted branch leaves this dangling on purpose — dropping the user
     * would be worse.
     */
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", index: true },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true }
);

export const User: Model<IUser> = models.User ?? model<IUser>("User", userSchema);
