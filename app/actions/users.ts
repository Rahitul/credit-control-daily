"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { Types } from "mongoose";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { User } from "@/lib/models/User";
import { logActivity } from "@/lib/audit";
import { ROLES, type ActionResult, type Role } from "@/lib/types";
import { Branch } from "@/lib/models/Branch";
import { isBranchId } from "@/lib/branchesData";

/**
 * Read + validate the branch picker.
 *
 * Blank means "no branch", which is a real state (not an error) and is written as
 * an `$unset` so a user removed from a branch does not keep a dangling link.
 * A malformed id is rejected outright rather than passed to Mongoose, which
 * *throws* a CastError on one instead of returning null.
 *
 * The branch NAME is resolved here so the activity log records what an admin can
 * read, not an ObjectId.
 */
async function readBranch(
  formData: FormData
): Promise<
  { ok: true; branchId?: string; branchName?: string } | { ok: false; error: string }
> {
  const raw = String(formData.get("branchId") ?? "").trim();
  if (!raw) return { ok: true };

  if (!isBranchId(raw)) {
    return { ok: false, error: "That branch no longer exists." };
  }
  const branch = await Branch.findById(raw).select({ name: 1 }).lean().exec();
  if (!branch) {
    return { ok: false, error: "That branch no longer exists." };
  }
  return { ok: true, branchId: raw, branchName: branch.name };
}

export async function createUser(
  _prev: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const admin = await requireRole("admin");

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const department = String(formData.get("department") ?? "").trim();
  const status = String(formData.get("status") ?? "active");
  const roles = formData.getAll("roles").map(String) as Role[];

  if (!name || !email || !password) {
    return { ok: false, error: "Name, email and password are required." };
  }
  if (password.length < 6) {
    return { ok: false, error: "Password must be at least 6 characters." };
  }
  const validRoles = roles.filter((r) => ROLES.includes(r));
  if (validRoles.length === 0) {
    return { ok: false, error: "Select at least one role." };
  }

  try {
    await db();
    const branch = await readBranch(formData);
    if (!branch.ok) return { ok: false, error: branch.error };

    const existing = await User.findOne({ email })
      .select({ _id: 1 })
      .lean()
      .exec();
    if (existing) {
      return { ok: false, error: "A user with this email already exists." };
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const doc = await User.create({
      name,
      email,
      passwordHash,
      role: validRoles,
      department: department || undefined,
      branchId: branch.branchId ? new Types.ObjectId(branch.branchId) : undefined,
      status: status === "inactive" ? "inactive" : "active",
    });

    await logActivity({
      user: admin,
      action: "create",
      module: "users",
      recordId: String(doc._id),
      detail: `Created user ${email} [${validRoles.join(", ")}]${branch.branchName ? ` · branch ${branch.branchName}` : ""}`,
    });

    revalidatePath("/admin/users");
    return { ok: true, id: String(doc._id) };
  } catch (err) {
    console.error("createUser", err);
    return { ok: false, error: "Failed to create user." };
  }
}

export async function updateUser(
  _prev: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const admin = await requireRole("admin");

  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const department = String(formData.get("department") ?? "").trim();
  const status = String(formData.get("status") ?? "active");
  const roles = formData.getAll("roles").map(String) as Role[];
  const password = String(formData.get("password") ?? "");

  if (!id || !name || !email) {
    return { ok: false, error: "Name and email are required." };
  }
  const validRoles = roles.filter((r) => ROLES.includes(r));
  if (validRoles.length === 0) {
    return { ok: false, error: "Select at least one role." };
  }

  try {
    await db();
    const branch = await readBranch(formData);
    if (!branch.ok) return { ok: false, error: branch.error };

    const update: Record<string, unknown> = {
      name,
      email,
      role: validRoles,
      department: department || undefined,
      status: status === "inactive" ? "inactive" : "active",
      updatedAt: new Date(),
    };
    // `$unset` rather than `$set: null` so removing a branch leaves no dangling
    // ref. Both are "no branch" to every read path, but only one of them is a
    // value a later index build has to reason about.
    if (branch.branchId) update.branchId = new Types.ObjectId(branch.branchId);
    if (password) {
      if (password.length < 6) {
        return { ok: false, error: "Password must be at least 6 characters." };
      }
      update.passwordHash = await bcrypt.hash(password, 10);
    }

    const ops: Record<string, unknown> = { $set: update };
    if (!branch.branchId) ops.$unset = { branchId: 1 };

    const result = await User.findByIdAndUpdate(id, ops, { new: true });
    if (!result) return { ok: false, error: "User not found." };

    await logActivity({
      user: admin,
      action: "update",
      module: "users",
      recordId: id,
      detail: `Updated user ${email} → roles [${validRoles.join(", ")}], status ${update.status}, branch ${branch.branchName ?? "none"}`,
    });

    revalidatePath("/admin/users");
    return { ok: true, id };
  } catch (err) {
    console.error("updateUser", err);
    return { ok: false, error: "Failed to update user." };
  }
}

export async function deleteUser(
  _prev: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const admin = await requireRole("admin");
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { ok: false, error: "User id required." };
  if (id === admin.id) {
    return { ok: false, error: "You cannot remove your own account." };
  }

  try {
    await db();
    const user = await User.findByIdAndDelete(id);
    if (!user) return { ok: false, error: "User not found." };

    await logActivity({
      user: admin,
      action: "delete",
      module: "users",
      recordId: id,
      detail: `Deleted user ${user.email}`,
    });

    revalidatePath("/admin/users");
    return { ok: true, id };
  } catch (err) {
    console.error("deleteUser", err);
    return { ok: false, error: "Failed to delete user." };
  }
}
