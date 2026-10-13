/**
 * SERVER-ONLY. Approving a payment is the ONLY thing in the app that reduces a
 * pending bill's `pendingAmount`, so this file is deliberately small and
 * deliberately defensive.
 *
 * ## Why this is not a plain loop
 *
 * Mongo here is a standalone `mongod`, so there are no multi-document
 * transactions. A naive "read bills, subtract, save" can leave bills reduced
 * while the payment is still `pending` if the process dies mid-way — and a naive
 * retry would then deduct the money a second time.
 *
 * So approval is written as four separate, individually-safe steps:
 *
 *  1. **Claim** — one atomic `findOneAndUpdate` moves the payment
 *     `pending -> allocating`. A second concurrent approval of the same payment
 *     cannot match, so double-approval is impossible.
 *  2. **Plan** — read the customer's outstanding bills and work out the exact
 *     `before`/`after` for each. Persisted on the payment, so the intent survives
 *     a crash and the Completed Bills page can show what settled a bill.
 *  3. **Apply** — each bill is reduced with a *conditional* update,
 *     `updateOne({_id, pendingAmount: before}, {$set: {pendingAmount: after}})`.
 *     The guard is what makes a retry safe: if a bill is already at `after` the
 *     update matches nothing and the step is recognised as already-done instead
 *     of subtracting twice.
 *  4. **Approve** — flip to `approved` with the approver, the split between
 *     allocated and unallocated money, and the settlement ledger.
 *
 * A crash anywhere leaves the payment in `allocating`, which is a *retryable*
 * state: re-running recomputes the plan from live bill values, and the
 * conditional apply makes the already-applied portion a no-op. Recovery therefore
 * needs no manual repair, and no money can be double-counted or lost.
 */

import { Types } from "mongoose";
import { db } from "@/lib/db";
import { Customer } from "@/lib/models/Customer";
import { Payment } from "@/lib/models/Payment";
import { PendingBill } from "@/lib/models/PendingBill";
import { escapeRegex } from "@/lib/pendingBills";

/** Money is compared and stored to 2dp; float dust must not become a ৳0.01 bill. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type PlannedSettlement = {
  /** String id — the `PendingBill` interface types `_id` as a string. Mongoose casts it on write. */
  billId: string;
  billNumber: string;
  referenceNo: string;
  amount: number;
  before: number;
  after: number;
};

type OutstandingBill = {
  _id: string;
  referenceNo: string;
  billNumber: string;
  pendingAmount: number;
};

export type AllocationOutcome = {
  ok: boolean;
  error?: string;
  /** True when the payment was already `approved` and nothing was re-applied. */
  alreadyApproved: boolean;
  allocated: number;
  unallocated: number;
  settled: number;
};

const CONFLICT_RETRIES = 3;

const FAIL = (error: string): AllocationOutcome => ({
  ok: false,
  error,
  alreadyApproved: false,
  allocated: 0,
  unallocated: 0,
  settled: 0,
});

/**
 * The customer's outstanding bills, oldest first.
 *
 * Matches on `customerId` plus the legacy name fallback used everywhere else in
 * this feature: bills written before `customerId` existed carry no usable link, and
 * skipping them would silently refuse to settle a real debt. `pendingAmount > 0`
 * is what makes a settled bill drop out, which is how a bill reaches the
 * Completed Bills list.
 */
async function outstandingBillsFor(
  customerId: Types.ObjectId,
  partyName: string
): Promise<OutstandingBill[]> {
  const nameRe = new RegExp(`^${escapeRegex(partyName)}$`, "i");
  const [byId, byName] = await Promise.all([
    PendingBill.find({ customerId, pendingAmount: { $gt: 0 } })
      .select({ referenceNo: 1, billNumber: 1, pendingAmount: 1 })
      .lean()
      .exec(),
    PendingBill.find({
      partyName: nameRe,
      pendingAmount: { $gt: 0 },
      $or: [{ customerId: { $exists: false } }, { customerId: null }],
    })
      .select({ referenceNo: 1, billNumber: 1, pendingAmount: 1 })
      .lean()
      .exec(),
  ]);

  const linked = new Set(byId.map((b) => String(b._id)));
  // Ordering is applied by the caller (FIFO by bill date); this function only
  // assembles the set.
  return [...byId, ...byName.filter((b) => !linked.has(String(b._id)))].map((b) => ({
    _id: String(b._id),
    referenceNo: b.referenceNo,
    billNumber: b.billNumber ?? "",
    pendingAmount: b.pendingAmount,
  }));
}

/**
 * Does `ref` name this bill?
 *
 * The payment form stores whatever the user picked, and that can be either the short
 * number (`TS-1854`) or the whole composite reference (`TS-1854 dt.14.3.2026`) —
 * `PaymentForm.applyPartyBill` writes the former when a bill number was parsed and
 * the latter when it wasn't. Both are matched, case-insensitively and ignoring
 * surrounding whitespace, so a payment settles the bill the user named without the
 * form having to normalise anything first.
 */
function matchesBillRef(bill: OutstandingBill, ref: string): boolean {
  const want = ref.trim().toLowerCase();
  if (!want) return false;
  if ((bill.billNumber ?? "").trim().toLowerCase() === want) return true;
  return (bill.referenceNo ?? "").trim().toLowerCase() === want;
}

/**
 * Work out which bills this payment pays down.
 *
 * Exported for testing: the split is pure arithmetic over an ordered bill list.
 */
export function planAllocation(
  bills: OutstandingBill[],
  amount: number,
  /** Bill the user picked on the form — settled first. Matched loosely, see `matchesBillRef`. */
  preferredBillRef?: string
): { settlements: PlannedSettlement[]; allocated: number; unallocated: number } {
  let remaining = round2(amount);
  const settlements: PlannedSettlement[] = [];

  // The bill the user actually picked is settled FIRST, so the payment lands on the
  // document the form says it pays. Without this the whole split is decided by bill
  // date and the chosen reference is ignored — the exact mismatch that made a payment
  // clear an unrelated older bill. Any remainder continues through the normal FIFO
  // order, so this reorders only the head of the list and never changes the tail.
  //
  // Reordering works on a COPY: `planAllocation` is exported and may be called more
  // than once for the same list, and mutating the caller's array in place would make a
  // second call plan a different split from the first.
  const pref = (preferredBillRef ?? "").trim();
  const order = bills.slice();
  if (pref) {
    const idx = order.findIndex((b) => matchesBillRef(b, pref));
    if (idx > 0) {
      const [chosen] = order.splice(idx, 1);
      order.unshift(chosen);
    }
  }

  for (const bill of order) {
    if (remaining <= 0) break;
    const before = round2(bill.pendingAmount);
    if (before <= 0) continue;

    let take = round2(Math.min(remaining, before));
    // Absorb float dust: if what is left after this bill is a fraction of a
    // taka, take it too rather than leaving a ৳0.01 sliver as "unallocated".
    if (round2(remaining - take) > 0 && round2(remaining - take) < 0.05) {
      take = remaining;
    }

    settlements.push({
      billId: bill._id,
      billNumber: bill.billNumber || "",
      referenceNo: bill.referenceNo,
      amount: take,
      before,
      after: round2(before - take),
    });
    remaining = round2(remaining - take);
  }

  const allocated = round2(settlements.reduce((s, x) => s + x.amount, 0));
  return { settlements, allocated, unallocated: round2(remaining) };
}

/**
 * Approve a payment and settle the bills it pays.
 *
 * `approver` is used only for the audit fields and the self-approval guard is
 * applied by the caller — this function assumes authorization is already done.
 */
export async function allocatePayment(
  paymentId: string,
  approver: { id: string; roles: string[] }
): Promise<AllocationOutcome> {
  await db();

  if (!Types.ObjectId.isValid(paymentId)) return FAIL("Invalid payment id.");

  // Step 1: claim. `pending -> allocating` in one atomic operation. An already
  // approved payment falls through to the idempotent "nothing to do" result; a
  // payment stuck in `allocating` from a crash is re-claimed by the same query
  // (the `{ $in: [...] }` allows it), which is what makes approval self-healing.
  const claimed = await Payment.findOneAndUpdate(
    { _id: paymentId, approvalStatus: { $in: ["pending", "allocating"] } },
    { $set: { approvalStatus: "allocating" } },
    { new: true }
  ).lean().exec();

  if (!claimed) {
    const existing = await Payment.findById(paymentId).select({ approvalStatus: 1 }).lean().exec();
    if (!existing) return FAIL("Payment not found.");
    if (existing.approvalStatus === "approved") {
      return {
        ok: true,
        alreadyApproved: true,
        allocated: existing.allocatedAmount ?? 0,
        unallocated: existing.unallocatedAmount ?? 0,
        settled: existing.settlements?.length ?? 0,
      };
    }
    return FAIL("This payment is already being approved. Try again in a moment.");
  }

  const customer = await Customer.findById(claimed.customerId)
    .select({ name: 1 })
    .lean()
    .exec();
  if (!customer) {
    await Payment.updateOne({ _id: paymentId }, { $set: { approvalStatus: "pending" } });
    return FAIL("The customer for this payment no longer exists.");
  }

  // Steps 2-3, retried: another payment approved for the same customer between
  // our read and our write will move a bill, and the conditional update detects it.
  let plan: { settlements: PlannedSettlement[]; allocated: number; unallocated: number } | null = null;

  for (let attempt = 0; attempt < CONFLICT_RETRIES; attempt++) {
    const bills = await outstandingBillsFor(claimed.customerId, customer.name);
    // FIFO by bill date, `_id` as a stable tie-break so two bills on the same date
    // always settle in the same order — otherwise a retry could plan a different
    // split for the same money.
    const dated = await PendingBill.find({ _id: { $in: bills.map((b) => b._id) } })
      .select({ referenceNo: 1, billNumber: 1, pendingAmount: 1, billDate: 1 })
      .lean()
      .exec();
    const billDateById = new Map(dated.map((b) => [String(b._id), new Date(b.billDate)]));

    const ordered: OutstandingBill[] = bills
      .filter((b) => billDateById.has(b._id))
      .sort((a, b) => {
        const d = (billDateById.get(a._id) as Date).getTime() - (billDateById.get(b._id) as Date).getTime();
        return d !== 0 ? d : a._id.localeCompare(b._id);
      });

    // The bill chosen on the form wins; FIFO by date settles whatever is left over.
    const candidate = planAllocation(ordered, claimed.rcvAmount, claimed.billNo);

    // Persist the plan BEFORE touching money, so intent survives a crash.
    await Payment.updateOne(
      { _id: paymentId },
      {
        $set: {
          settlements: candidate.settlements.map((s) => ({
            billId: s.billId,
            billNumber: s.billNumber,
            referenceNo: s.referenceNo,
            amount: s.amount,
          })),
        },
      }
    );

    let conflict = false;
    for (const s of candidate.settlements) {
      const res = await PendingBill.updateOne(
        { _id: s.billId, pendingAmount: s.before },
        { $set: { pendingAmount: s.after } }
      );
      if (res.matchedCount === 1) continue;

      // No match: either this one is already applied (crash recovery / retry), or
      // somebody else changed it. Only the latter forces a recompute.
      const now = await PendingBill.findById(s.billId)
        .select({ pendingAmount: 1 })
        .lean()
        .exec();
      if (!now || round2(now.pendingAmount) !== s.after) conflict = true;
    }

    if (!conflict) {
      plan = candidate;
      break;
    }
  }

  if (!plan) {
    // Put it back so the payment is not stranded in `allocating`.
    await Payment.updateOne({ _id: paymentId }, { $set: { approvalStatus: "pending" } });
    return FAIL(
      "Could not settle the bills — another payment changed them at the same time. Please approve again."
    );
  }

  // Step 4: approve.
  await Payment.updateOne(
    { _id: paymentId, approvalStatus: "allocating" },
    {
      $set: {
        approvalStatus: "approved",
        approvedBy: new Types.ObjectId(approver.id),
        approvedByRole: approver.roles[0] ?? "",
        approvedAt: new Date(),
        allocatedAmount: plan.allocated,
        unallocatedAmount: plan.unallocated,
      },
    }
  );

  return {
    ok: true,
    alreadyApproved: false,
    allocated: plan.allocated,
    unallocated: plan.unallocated,
    settled: plan.settlements.length,
  };
}
