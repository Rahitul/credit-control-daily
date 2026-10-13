/**
 * SERVER-ONLY: reading `Branch` records for bill routing.
 *
 * The router (`routeReference()` in `lib/pendingBills.ts`) is pure and takes the
 * branch list as a plain argument, so every write path loads it here exactly once
 * and passes it down. Call it ONCE per request, outside any row loop — an import
 * of 5000 bills derives routing twice per row, so a per-row lookup would be 10,000
 * queries.
 *
 * There is deliberately NO cache. Branches are admin-managed and change rarely,
 * but a cached prefix list means a bill entered seconds after Admin adds a branch
 * silently routes as if the branch did not exist — and routing is persisted on the
 * row, so the mistake is invisible until someone re-derives it by hand. One lean
 * projection off a unique index is cheap; a wrong route is not recoverable from the
 * UI.
 */

import { Types } from "mongoose";
import { db } from "@/lib/db";
import { Branch } from "@/lib/models/Branch";
import { sortBranchPrefixes, type BranchRouteInput } from "@/lib/branches";

export type { BranchRouteInput };

/**
 * Every ACTIVE branch, longest prefix first. Inactive branches are excluded so
 * switching one off immediately stops new bills routing to it; rows already
 * routed keep their stored `departments` and `branchId`.
 */
export async function getBranchRoutes(): Promise<BranchRouteInput[]> {
  await db();
  const docs = await Branch.find({ active: true })
    .select({ name: 1, prefix: 1 })
    .lean()
    .exec();

  return sortBranchPrefixes(
    docs.map((b) => ({ id: String(b._id), name: b.name, prefix: b.prefix }))
  );
}

/** Every branch, active or not, for the admin table and the Users page picker. */
export async function listBranches() {
  await db();
  return Branch.find()
    .sort({ active: -1, name: 1 })
    .lean()
    .exec();
}

export type BranchOption = { id: string; name: string; prefix: string };

/**
 * `{ id, name }` for the Users & Roles branch picker. All branches, because a
 * user assigned to a deactivated branch must still show that branch rather than
 * an empty box that would silently clear on save.
 */
export async function branchOptions(): Promise<BranchOption[]> {
  await db();
  const docs = await Branch.find()
    .sort({ name: 1 })
    .select({ name: 1, prefix: 1 })
    .lean()
    .exec();
  return docs.map((b) => ({
    id: String(b._id),
    name: b.name,
    prefix: b.prefix,
  }));
}

export function isBranchId(value: string): boolean {
  return Types.ObjectId.isValid(value);
}

/** Case-insensitive whole-name duplicate check, so two branches cannot share a name. */
export async function nameTakenElsewhere(
  name: string,
  exceptId?: string
): Promise<boolean> {
  await db();
  const re = new RegExp(
    `^${name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
    "i"
  );
  const query: Record<string, unknown> = { name: re };
  if (exceptId) query._id = { $ne: exceptId };
  const hit = await Branch.findOne(query).select({ _id: 1 }).lean().exec();
  return !!hit;
}
