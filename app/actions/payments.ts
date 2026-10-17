"use server";

import { revalidatePath } from "next/cache";
import { Types } from "mongoose";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { Payment } from "@/lib/models/Payment";
import { Customer } from "@/lib/models/Customer";
import { getCustomerCredit } from "@/lib/credit";
import { allocatePayment } from "@/lib/paymentAllocation";
import { logActivity } from "@/lib/audit";
import { ENTRY_ROLES, PAYMENT_APPROVER_ROLES, primaryRole } from "@/lib/nav";
import type { ActionResult } from "@/lib/types";

export async function createPayment(
  _prev: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await requireRole(...ENTRY_ROLES);

  const rcvDate = String(formData.get("rcvDate") ?? "").trim();
  const customerId = String(formData.get("customerId") ?? "").trim();
  const branch = String(formData.get("branch") ?? "").trim();
  const billCategory = String(formData.get("billCategory") ?? "").trim();
  const billNo = String(formData.get("billNo") ?? "").trim();
  const billDate = String(formData.get("billDate") ?? "").trim();
  const paymentType = String(formData.get("paymentType") ?? "").trim();
  const isDiscounted = formData.get("isDiscounted") === "on";
  const isVat = formData.get("isVat") === "on";
  const isTaxAit = formData.get("isTaxAit") === "on";
  const rcvAmount = Number(formData.get("rcvAmount"));
  const bankType = String(formData.get("bankType") ?? "").trim();
  const bankName = String(formData.get("bankName") ?? "").trim();
  const assignedPerson = String(formData.get("assignedPerson") ?? "").trim();
  const remarks = String(formData.get("remarks") ?? "").trim();
  const relatedSaleReferenceId = String(
    formData.get("relatedSaleReferenceId") ?? ""
  ).trim();

  if (!rcvDate || !customerId || !paymentType) {
    return { ok: false, error: "Rcv date, customer and payment type are required." };
  }
  if (!Number.isFinite(rcvAmount) || rcvAmount <= 0) {
    return { ok: false, error: "Received amount must be a positive number." };
  }

  try {
    await db();

    const customer = await Customer.findById(customerId)
      .select({ name: 1, approvalStatus: 1 })
      .lean()
      .exec();
    if (!customer) {
      return { ok: false, error: "Customer not found." };
    }
    if (customer.approvalStatus !== "approved") {
      return {
        ok: false,
        error: `"${customer.name}" is pending approval and cannot receive payments.`,
      };
    }

    const doc = await Payment.create({
      rcvDate: new Date(rcvDate),
      customerId,
      branch: branch || undefined,
      billCategory: billCategory || undefined,
      billNo: billNo || undefined,
      billDate: billDate ? new Date(billDate) : undefined,
      paymentType,
      isDiscounted,
      isVat,
      isTaxAit,
      rcvAmount,
      bankType: bankType || undefined,
      bankName: bankName || undefined,
      assignedPerson: assignedPerson || undefined,
      remarks: remarks || undefined,
      entryBy: user.name,
      createdBy: new Types.ObjectId(user.id),
      createdByRole: primaryRole(user.roles),
      relatedSaleReferenceId: relatedSaleReferenceId || undefined,
      // Every payment enters as `pending`. Only approval (see `approvePayment`)
      // settles bills, so an unapproved payment moves no outstanding figure.
      approvalStatus: "pending",
    });

    const credit = await getCustomerCredit(customerId);

    await logActivity({
      user,
      action: "create",
      module: "payments",
      recordId: String(doc._id),
      detail: `Payment ৳${rcvAmount} (${paymentType}) · ${credit?.name ?? customerId} · entered by ${user.name} (${primaryRole(user.roles)})`,
    });

    revalidatePath("/", "layout");
    return { ok: true, id: String(doc._id) };
  } catch (err) {
    console.error("createPayment", err);
    return { ok: false, error: "Failed to submit payment entry." };
  }
}

/**
 * Reject a payment: HARD DELETE of a still-pending entry.
 *
 * Accounts/Admin only, same gate as approval. Only `pending` payments qualify —
 * an `approved` one has already reduced bill balances through `allocatePayment`,
 * and an `allocating` one is mid-approval, so deleting either would strand the
 * money. No self-rejection block on purpose: rejecting moves no money, it only
 * removes an entry nobody has released yet, and being able to withdraw your own
 * mistaken entry is the useful case.
 */
export async function rejectPayment(
  _prev: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult & { detail?: string }> {
  const paymentId = String(formData.get("paymentId") ?? "").trim();

  try {
    const user = await requireRole(...PAYMENT_APPROVER_ROLES);
    await db();

    if (!paymentId || !Types.ObjectId.isValid(paymentId)) {
      return { ok: false, error: "Invalid payment." };
    }

    const payment = await Payment.findById(paymentId).lean().exec();
    if (!payment) return { ok: false, error: "Payment not found." };

    if (payment.approvalStatus === "approved") {
      return { ok: false, error: "This payment is already approved, so it cannot be rejected." };
    }
    if (payment.approvalStatus !== "pending") {
      return {
        ok: false,
        error: "This payment is mid-approval. Wait for it to finish, then try again.",
      };
    }

    // Conditional delete: if another approver released this payment between our
    // read and this write, `deletedCount` is 0 and we must not pretend it worked.
    const res = await Payment.deleteOne({ _id: paymentId, approvalStatus: "pending" });
    if (res.deletedCount === 0) {
      return {
        ok: false,
        error: "This payment is no longer pending — it may have just been approved.",
      };
    }

    const credit = await getCustomerCredit(String(payment.customerId));
    await logActivity({
      user,
      action: "reject",
      module: "payments",
      recordId: paymentId,
      detail:
        `Rejected and deleted pending payment ৳${payment.rcvAmount} (${payment.paymentType}) · ` +
        `${credit?.name ?? String(payment.customerId)} · by ${user.name} (${primaryRole(user.roles)})`,
    });

    revalidatePath("/", "layout");
    revalidatePath("/admin/payments", "layout");
    return { ok: true, id: paymentId, detail: "Payment rejected and deleted." };
  } catch (err) {
    console.error("rejectPayment", err);
    return { ok: false, error: "Failed to reject this payment." };
  }
}

/**
 * Approve a payment and settle the bills it pays.
 *
 * Authorization, the self-approval guard and the audit log live here; the actual
 * money movement is in `allocatePayment`, which is written to be safe to retry.
 *
 * Self-approval is refused on purpose: whoever entered the money must not also be
 * the one who releases it against a bill. Note this means a payment whose author
 * has left the company (or whose account was deleted) can only be approved by
 * someone else — a deliberate trade for the control.
 */
export async function approvePayment(
  _prev: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult & { detail?: string }> {
  const paymentId = String(formData.get("paymentId") ?? "").trim();

  try {
    const user = await requireRole(...PAYMENT_APPROVER_ROLES);
    await db();

    if (!paymentId || !Types.ObjectId.isValid(paymentId)) {
      return { ok: false, error: "Invalid payment." };
    }

    const payment = await Payment.findById(paymentId).lean().exec();
    if (!payment) return { ok: false, error: "Payment not found." };

    if (payment.approvalStatus === "approved") {
      return { ok: true, id: paymentId, detail: "This payment was already approved." };
    }

    // `createdBy` is the source of truth; `entryBy` is a legacy name snapshot and
    // is only consulted for pre-migration rows that have no ObjectId.
    const authorId = payment.createdBy ? String(payment.createdBy) : "";
    if (authorId && authorId === user.id) {
      return {
        ok: false,
        error: "You entered this payment, so someone else has to approve it.",
      };
    }
    if (!authorId && payment.entryBy && payment.entryBy === user.name) {
      return {
        ok: false,
        error: "You entered this payment, so someone else has to approve it.",
      };
    }

    const outcome = await allocatePayment(paymentId, { id: user.id, roles: user.roles });

    if (!outcome.ok) {
      return { ok: false, error: outcome.error ?? "Could not approve this payment." };
    }

    if (!outcome.alreadyApproved) {
      const credit = await getCustomerCredit(String(payment.customerId));
      const settled = outcome.settled
        ? `settled ${outcome.settled} bill${outcome.settled === 1 ? "" : "s"}`
        : "settled no bills";
      await logActivity({
        user,
        action: "approve",
        module: "payments",
        recordId: paymentId,
        detail:
          `Approved payment ৳${payment.rcvAmount} · ${credit?.name ?? String(payment.customerId)} · ` +
          `${settled} · allocated ৳${outcome.allocated}` +
          (outcome.unallocated > 0 ? ` · ৳${outcome.unallocated} unallocated` : ""),
      });
    }

    revalidatePath("/", "layout");
    revalidatePath("/admin/payments", "layout");

    const unallocatedNote =
      outcome.unallocated > 0
        ? ` Warning: ৳${outcome.unallocated} matched no outstanding bill.`
        : "";
    return {
      ok: true,
      id: paymentId,
      detail: outcome.alreadyApproved
        ? "This payment was already approved."
        : `Approved. ৳${outcome.allocated} applied to ${outcome.settled} bill${
            outcome.settled === 1 ? "" : "s"
          }.${unallocatedNote}`,
    };
  } catch (err) {
    console.error("approvePayment", err);
    return { ok: false, error: "Failed to approve this payment." };
  }
}
