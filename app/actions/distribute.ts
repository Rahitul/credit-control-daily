"use server";

/**
 * Work distribution: hand rows of the SALES register to a specific sales user.
 *
 * The sales app is allocation-scoped (see `salesAssigneeClause` in `lib/nav.ts`),
 * which means a row nobody owns is invisible to every salesperson. These actions
 * are the only way `assignedTo` is ever set on an EXISTING row.
 *
 * Two invariants this file exists to enforce:
 *
 * 1. **`assignedTo` is never derived and never touched by a row save.** Only this
 *    file, the auto-assign on a sales user's own insert (`assigneeForNewRow`), and
 *    the backfill script write it. That separation is what makes the sales app
 *    safe: a sales user cannot grant themselves a row by editing it, and
 *    re-importing or re-saving a file cannot quietly redistribute the register.
 *
 * 2. **Accounts/Admin only.** `requireRole` — never a bare session read — so the
 *    check cannot be skipped by a caller that forgets to pass a role.
 */

import { revalidatePath } from "next/cache";
import { Types } from "mongoose";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { PendingBill } from "@/lib/models/PendingBill";
import { Sale } from "@/lib/models/Sale";
import { User } from "@/lib/models/User";
import { logActivity } from "@/lib/audit";
import { ACCOUNTS_ROLES, primaryRole } from "@/lib/nav";
import type { ActionResult, SessionUser } from "@/lib/types";

/** Guard against a pasted-in form posting thousands of ids. */
const MAX_BATCH = 500;

const HEX24 = /^[0-9a-fA-F]{24}$/;

type Target = "pendingBills" | "sales";

function readIds(formData: FormData): string[] {
  return formData
    .getAll("ids")
    .map((v) => String(v).trim())
    .filter((v) => HEX24.test(v));
}

/**
 * Resolve the assignee, insisting they are a real, active user holding `sales`.
 *
 * An assignee who does not hold the sales role would produce a row that no
 * salesperson can ever open, so this is refused rather than written and
 * discovered later.
 */
async function resolveAssignee(id: string): Promise<{ id: string; name: string } | null> {
  if (!HEX24.test(id)) return null;
  const user = await User.findById(id)
    .select({ name: 1, role: 1, status: 1 })
    .lean()
    .exec();
  if (!user) return null;
  if (user.status === "inactive") return null;
  // `User.role` is the field; the session calls it `roles`. A legacy doc could
  // hold a bare string, so normalise before testing membership.
  const roles = Array.isArray(user.role) ? user.role : [user.role];
  if (!roles.includes("sales")) return null;
  return { id: String(user._id), name: user.name };
}

/**
 * Assign rows to a user. An empty `assigneeId` is the explicit UNASSIGN action,
 * so taking a row back off somebody's desk is the same code path with one branch
 * rather than a second pair of near-identical actions to keep in step.
 *
 * Every id is re-validated against the target collection AND checked for sales
 * routing: the form is hand-writable, so a crafted `ids` list must not be able to
 * hand a Consumable or EID bill to a salesperson, which would put it in their
 * list while leaving it out of the app that owns it.
 *
 * The two collections are branched rather than held in one `model` variable
 * because `PendingBill | Sale` collapses Mongoose's generics and every chained
 * call becomes uncallable.
 */
async function applyAssignment(
  target: Target,
  ids: string[],
  assigneeId: string,
  actor: SessionUser
): Promise<ActionResult> {
  if (ids.length === 0) return { ok: false, error: "Select at least one row." };
  if (ids.length > MAX_BATCH) {
    return {
      ok: false,
      error: `Please distribute at most ${MAX_BATCH} rows at a time (got ${ids.length}).`,
    };
  }

  let assignee: { id: string; name: string } | null = null;
  if (assigneeId) {
    assignee = await resolveAssignee(assigneeId);
    if (!assignee) {
      return {
        ok: false,
        error: "That person is not an active user with the Sales role.",
      };
    }
  }

  try {
    await db();

    // `$set: null` is how an allocation gets CLEARED. `create` rejects null and
    // `$unset` is not equivalent for a typed ref field, so the branches are
    // spelled out rather than shared.
    const targetId = assignee ? new Types.ObjectId(assignee.id) : null;
    // `as const` keeps "sales" a literal — a widened `string` is not assignable
    // to the schema's `Role[]` element type.
    const matched = { _id: { $in: ids }, departments: "sales" as const };

    const label = target === "pendingBills" ? "pending bill" : "sale";
    let modified: number;
    let sample: string[];

    if (target === "pendingBills") {
      const docs = await PendingBill.find(matched)
        .select({ referenceNo: 1, partyName: 1 })
        .lean()
        .exec();
      if (docs.length !== ids.length) {
        return {
          ok: false,
          error: `${ids.length - docs.length} of ${ids.length} rows are not Sales-routed and were left untouched. Distribute the sales register only.`,
        };
      }
      sample = docs.map((d) => d.referenceNo);
      const res = await PendingBill.updateMany(matched, { $set: { assignedTo: targetId } });
      modified = res.modifiedCount;
    } else {
      const docs = await Sale.find(matched)
        .select({ referenceId: 1, billNo: 1 })
        .lean()
        .exec();
      if (docs.length !== ids.length) {
        return {
          ok: false,
          error: `${ids.length - docs.length} of ${ids.length} rows are not Sales-routed and were left untouched. Distribute the sales register only.`,
        };
      }
      sample = docs.map((d) => d.referenceId);
      const res = await Sale.updateMany(matched, { $set: { assignedTo: targetId } });
      modified = res.modifiedCount;
    }

    const verb = assignee ? `assigned to ${assignee.name}` : "unassigned";
    const noun = `${modified} ${label}${modified === 1 ? "" : "s"}`;

    await logActivity({
      user: actor,
      action: assignee ? "assign" : "unassign",
      module: "distribute",
      detail: `${noun} ${verb} · ${sample.slice(0, 5).join(", ")}${
        sample.length > 5 ? ` +${sample.length - 5} more` : ""
      } · by ${actor.name} (${primaryRole(actor.roles)})`,
    });

    revalidatePath("/", "layout");
    return { ok: true, error: `${noun} ${verb}.` };
  } catch (err) {
    console.error(target === "pendingBills" ? "assignPendingBills" : "assignSales", err);
    return { ok: false, error: "Failed to update the distribution." };
  }
}

export async function assignPendingBills(
  _prev: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await requireRole(...ACCOUNTS_ROLES);
  return applyAssignment(
    "pendingBills",
    readIds(formData),
    String(formData.get("assigneeId") ?? "").trim(),
    user
  );
}

export async function assignSales(
  _prev: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await requireRole(...ACCOUNTS_ROLES);
  return applyAssignment(
    "sales",
    readIds(formData),
    String(formData.get("assigneeId") ?? "").trim(),
    user
  );
}
