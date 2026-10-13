"use server";

import { revalidatePath } from "next/cache";
import { Types } from "mongoose";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { Branch } from "@/lib/models/Branch";
import { PendingBill } from "@/lib/models/PendingBill";
import { Sale } from "@/lib/models/Sale";
import { User } from "@/lib/models/User";
import { logActivity } from "@/lib/audit";
import { primaryRole } from "@/lib/nav";
import { validateBranchName, validateBranchPrefix } from "@/lib/branches";
import { isBranchId, nameTakenElsewhere } from "@/lib/branchesData";
import type { ActionResult } from "@/lib/types";

/**
 * Branches are ADMIN-ONLY, unlike dropdowns (which every entry role manages).
 * A branch prefix silently redirects bills between apps, so it is not something a
 * department user can change.
 *
 * There is no `department` field: a branch is an office, and the department a bill
 * belongs to is derived from its reference, not stored against the branch.
 */
type BranchFields = { name: string; prefix: string; note: string };

function readFields(formData: FormData): BranchFields {
  return {
    name: String(formData.get("name") ?? "").trim(),
    prefix: String(formData.get("prefix") ?? "").trim(),
    note: String(formData.get("note") ?? "").trim(),
  };
}

export async function createBranch(
  _prev: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await requireRole("admin");

  const f = readFields(formData);

  const name = validateBranchName(f.name);
  if (!name.ok) return { ok: false, error: name.error };

  const prefix = validateBranchPrefix(f.prefix);
  if (!prefix.ok) return { ok: false, error: prefix.error };

  try {
    await db();

    const clash = await Branch.findOne({ prefix: prefix.prefix })
      .select({ name: 1 })
      .lean()
      .exec();
    if (clash) {
      return {
        ok: false,
        error: `Prefix "${prefix.prefix}" is already used by ${clash.name}. Pick another — a prefix must be unique, or bills would route unpredictably.`,
      };
    }
    if (await nameTakenElsewhere(name.name)) {
      return { ok: false, error: `A branch called "${name.name}" already exists.` };
    }

    const doc = await Branch.create({
      name: name.name,
      prefix: prefix.prefix,
      note: f.note || undefined,
      active: true,
      createdBy: new Types.ObjectId(user.id),
    });

    await logActivity({
      user,
      action: "create",
      module: "branches",
      recordId: String(doc._id),
      detail: `Created branch ${name.name} (prefix ${prefix.prefix}) · by ${user.name} (${primaryRole(user.roles)})`,
    });

    revalidatePath("/", "layout");
    return { ok: true, id: String(doc._id) };
  } catch (err) {
    console.error("createBranch", err);
    // The unique index is the real guard against a concurrent duplicate.
    if ((err as { code?: number })?.code === 11000) {
      return { ok: false, error: `Prefix "${prefix.prefix}" is already in use.` };
    }
    return { ok: false, error: "Failed to create branch." };
  }
}

export async function updateBranch(
  _prev: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await requireRole("admin");

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { ok: false, error: "Branch id is required." };
  // A hand-typed id is reachable and Mongoose THROWS a CastError on a malformed
  // one rather than returning null, so guard before the query.
  if (!isBranchId(id)) return { ok: false, error: "Branch not found." };

  const f = readFields(formData);

  const name = validateBranchName(f.name);
  if (!name.ok) return { ok: false, error: name.error };

  const prefix = validateBranchPrefix(f.prefix);
  if (!prefix.ok) return { ok: false, error: prefix.error };

  const active = String(formData.get("active") ?? "true") !== "false";

  try {
    await db();

    const before = await Branch.findById(id).lean().exec();
    if (!before) return { ok: false, error: "Branch not found." };

    const clash = await Branch.findOne({ prefix: prefix.prefix, _id: { $ne: id } })
      .select({ name: 1 })
      .lean()
      .exec();
    if (clash) {
      return {
        ok: false,
        error: `Prefix "${prefix.prefix}" is already used by ${clash.name}. Pick another — a prefix must be unique, or bills would route unpredictably.`,
      };
    }
    if (await nameTakenElsewhere(name.name, id)) {
      return { ok: false, error: `A branch called "${name.name}" already exists.` };
    }

    await Branch.updateOne(
      { _id: id },
      {
        $set: {
          name: name.name,
          prefix: prefix.prefix,
          note: f.note || undefined,
          active,
        },
        ...(f.note ? {} : { $unset: { note: 1 } }),
      }
    );

    // Renaming or re-prefixing a branch does NOT rewrite the bills already routed
    // to it: `PendingBill.branchName` / `Sale.branchName` are write-time snapshots
    // and `departments` is persisted, so history keeps the branch it was entered
    // under. Bills only pick up a new prefix when they are next edited or
    // re-imported — the same rule that applies to changing `BILL_ROUTES`.
    const changes: string[] = [];
    if (before.prefix !== prefix.prefix) changes.push(`prefix ${before.prefix} → ${prefix.prefix}`);
    if (before.name !== name.name) changes.push(`name ${before.name} → ${name.name}`);
    if (before.active !== active) changes.push(active ? "reactivated" : "deactivated");

    await logActivity({
      user,
      action: "update",
      module: "branches",
      recordId: id,
      detail: `Updated branch ${name.name}${changes.length ? ` · ${changes.join(", ")}` : " · no change"} · by ${user.name} (${primaryRole(user.roles)})`,
    });

    revalidatePath("/", "layout");
    return { ok: true, id };
  } catch (err) {
    console.error("updateBranch", err);
    if ((err as { code?: number })?.code === 11000) {
      return { ok: false, error: `Prefix "${prefix.prefix}" is already in use.` };
    }
    return { ok: false, error: "Failed to update branch." };
  }
}

export async function deleteBranch(
  _prev: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await requireRole("admin");

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { ok: false, error: "Branch id is required." };
  if (!isBranchId(id)) return { ok: false, error: "Branch not found." };

  try {
    await db();

    const branch = await Branch.findById(id).lean().exec();
    if (!branch) return { ok: false, error: "Branch not found." };

    // Refuse rather than cascade. Deleting a branch would leave every bill and
    // sale that routed to it pointing at a branch that no longer exists, and there
    // is no UI that could re-derive them. Deactivate instead: it stops NEW bills
    // routing here while keeping the history intact.
    const [bills, sales, users] = await Promise.all([
      PendingBill.countDocuments({ branchId: new Types.ObjectId(id) }),
      Sale.countDocuments({ branchId: new Types.ObjectId(id) }),
      User.countDocuments({ branchId: new Types.ObjectId(id) }),
    ]);

    if (bills || sales || users) {
      const parts: string[] = [];
      if (bills) parts.push(`${bills} pending bill(s)`);
      if (sales) parts.push(`${sales} sale(s)`);
      if (users) parts.push(`${users} user(s)`);
      return {
        ok: false,
        error: `${branch.name} is still assigned to ${parts.join(", ")}. Deactivate it instead — deleting it would leave those rows pointing at a branch that no longer exists.`,
      };
    }

    await Branch.deleteOne({ _id: id });

    await logActivity({
      user,
      action: "delete",
      module: "branches",
      recordId: id,
      detail: `Deleted branch ${branch.name} (prefix ${branch.prefix}) · by ${user.name} (${primaryRole(user.roles)})`,
    });

    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    console.error("deleteBranch", err);
    return { ok: false, error: "Failed to delete branch." };
  }
}
