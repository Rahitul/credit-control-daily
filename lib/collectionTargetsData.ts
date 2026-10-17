/**
 * SERVER-ONLY read layer for Payment Collection Targets.
 *
 * Progress is measured against the RECEIVED date (`Payment.rcvDate`): a target
 * week means "payments received during this week", regardless of when the entry
 * was typed in.
 *
 * Only `approvalStatus: "approved"` payments count — the same rule every other
 * collected figure in the app uses. A pending payment is a claim, not released
 * money. Attribution is by `createdBy`, the user who stored the entry.
 */

import { Types } from "mongoose";
import { db } from "@/lib/db";
import { Payment } from "@/lib/models/Payment";
import { User } from "@/lib/models/User";
import { CollectionTarget } from "@/lib/models/CollectionTarget";
import { primaryRole } from "@/lib/nav";
import { ROLE_LABELS, type Role } from "@/lib/types";
import {
  bucketByWeek,
  monthLabel,
  monthRange,
  normalizeWeeks,
  sumWeeks,
} from "@/lib/collectionTargets";

export type CollectionTargetRow = {
  userId: string;
  name: string;
  role: Role;
  roleLabel: string;
  /** The four weekly targets, ৳. */
  target: number[];
  /** Approved collection received in each of the four weeks, ৳. */
  actual: number[];
  totalTarget: number;
  totalActual: number;
};

export type CollectionTargetsData = {
  year: number;
  month: number;
  label: string;
  rows: CollectionTargetRow[];
  totals: { target: number; actual: number };
};

export async function listTargetProgress(
  year: number,
  month: number,
  weekIndex?: number | null,
  /**
   * When set, the whole read is scoped to this one user — the personal view the
   * department apps render. Omitted, every active user is listed (the
   * admin/accounts/creditcontrol owner view).
   */
  userId?: string
): Promise<CollectionTargetsData> {
  await db();

  const { start, endExclusive } = monthRange(year, month);

  // A department caller must never be able to widen the read, so an unparseable
  // id answers with an empty month rather than the full user list.
  const ownerId =
    userId && Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : null;
  if (userId && !ownerId) {
    return {
      year,
      month,
      label: monthLabel(year, month),
      rows: [],
      totals: { target: 0, actual: 0 },
    };
  }

  const [users, targetDocs, payDocs] = await Promise.all([
    User.find(ownerId ? { _id: ownerId.toString() } : { status: "active" })
      .select({ name: 1, role: 1 })
      .sort({ name: 1 })
      .lean()
      .exec(),
    CollectionTarget.find(ownerId ? { userId: ownerId, year, month } : { year, month })
      .select({ userId: 1, weeks: 1 })
      .lean()
      .exec(),
    // Approved-only, windowed on rcvDate.
    Payment.find({
      approvalStatus: "approved",
      rcvDate: { $gte: start, $lt: endExclusive },
      ...(ownerId ? { createdBy: ownerId } : {}),
    })
      .select({ createdBy: 1, rcvAmount: 1, rcvDate: 1 })
      .lean()
      .exec(),
  ]);

  // Bucket the payments by the entering user, then by week. Rows with no
  // `createdBy` (legacy entries) belong to nobody and are dropped rather than
  // pooled into a fake "unknown" target.
  const paymentsByUser = new Map<
    string,
    { rcvAmount: number; date: Date }[]
  >();
  for (const p of payDocs) {
    if (!p.createdBy) continue;
    const key = String(p.createdBy);
    const list = paymentsByUser.get(key);
    const row = { rcvAmount: Number(p.rcvAmount) || 0, date: new Date(p.rcvDate) };
    if (list) list.push(row);
    else paymentsByUser.set(key, [row]);
  }

  const targetByUser = new Map<string, number[]>(
    targetDocs.map((t) => [String(t.userId), normalizeWeeks(t.weeks)])
  );

  const rows: CollectionTargetRow[] = users.map((u) => {
    const id = String(u._id);
    let target = targetByUser.get(id) ?? normalizeWeeks([]);
    let actual = bucketByWeek(paymentsByUser.get(id) ?? []);

    // When weekIndex is specified, zero out all other weeks so only the
    // selected week's target/actual are shown.
    if (weekIndex != null) {
      const wTarget = [...target];
      wTarget.forEach((_, i) => {
        if (i !== weekIndex) wTarget[i] = 0;
      });
      const wActual = [...actual];
      wActual.forEach((_, i) => {
        if (i !== weekIndex) wActual[i] = 0;
      });
      actual = wActual;
      target = wTarget;
    }

    const role = primaryRole(u.role);
    return {
      userId: id,
      name: u.name,
      role,
      roleLabel: ROLE_LABELS[role],
      target,
      actual,
      totalTarget: sumWeeks(target),
      totalActual: sumWeeks(actual),
    };
  });

  const totals = rows.reduce(
    (acc, r) => ({ target: acc.target + r.totalTarget, actual: acc.actual + r.totalActual }),
    { target: 0, actual: 0 }
  );

  return { year, month, label: monthLabel(year, month), rows, totals };
}



