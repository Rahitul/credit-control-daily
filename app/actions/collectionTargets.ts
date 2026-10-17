"use server";

import { revalidatePath } from "next/cache";
import { Types } from "mongoose";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { CollectionTarget } from "@/lib/models/CollectionTarget";
import { logActivity } from "@/lib/audit";
import { primaryRole } from "@/lib/nav";
import { WEEKS_IN_MONTH, sumWeeks } from "@/lib/collectionTargets";
import type { ActionResult } from "@/lib/types";

/**
 * Who may set collection targets. Admin and Accounts (the two roles that own the
 * money register), plus Credit Control, which shares Accounts privileges
 * elsewhere in the app.
 */
const TARGET_ROLES = ["admin", "accounts", "creditcontrol"] as const;

/**
 * Save a whole month's per-user weekly targets in one submit.
 *
 * Inputs arrive as `week-<userId>-<weekIndex>` (0–3), because the page renders
 * every active user's four boxes in a single form. A user whose four boxes are
 * all zero/blank has their target row deleted rather than stored as zeros, so
 * "no target" stays distinguishable from "a target of 0".
 *
 * The role is re-checked here, never trusted from the form.
 */
export async function saveCollectionTargets(
  _prev: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await requireRole(...TARGET_ROLES);

  const year = Number(formData.get("year"));
  const month = Number(formData.get("month"));
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return { ok: false, error: "A valid year and month are required." };
  }

  // Group the flat `week-<userId>-<i>` fields back into one array per user.
  const byUser = new Map<string, number[]>();
  for (const [key, value] of formData.entries()) {
    const m = /^week-(.+)-(\d+)$/.exec(key);
    if (!m) continue;
    const userId = m[1];
    const i = Number(m[2]);
    if (i < 0 || i >= WEEKS_IN_MONTH) continue;
    const arr = byUser.get(userId) ?? [0, 0, 0, 0];
    const n = Number(value);
    arr[i] = Number.isFinite(n) && n > 0 ? n : 0;
    byUser.set(userId, arr);
  }

  if (byUser.size === 0) {
    return { ok: false, error: "No targets were submitted." };
  }

  try {
    await db();
    const uid = new Types.ObjectId(user.id);
    let saved = 0;
    let cleared = 0;

    for (const [userId, weeks] of byUser.entries()) {
      if (!Types.ObjectId.isValid(userId)) continue;
      const oid = new Types.ObjectId(userId);

      if (sumWeeks(weeks) === 0) {
        const res = await CollectionTarget.deleteOne({ userId: oid, year, month });
        cleared += res.deletedCount ?? 0;
        continue;
      }

      await CollectionTarget.updateOne(
        { userId: oid, year, month },
        {
          $set: { weeks, updatedBy: uid },
          // `userId`/`year`/`month` come from the upsert filter automatically;
          // only stamp the creator on insert.
          $setOnInsert: { createdBy: uid },
        },
        { upsert: true }
      );
      saved += 1;
    }

    await logActivity({
      user,
      action: "update",
      module: "collectionTargets",
      detail:
        `Set ${saved} collection target(s) for ${month}/${year}` +
        (cleared ? `, cleared ${cleared}` : "") +
        ` · by ${user.name} (${primaryRole(user.roles)})`,
    });

    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    console.error("saveCollectionTargets", err);
    return { ok: false, error: "Failed to save targets." };
  }
}
