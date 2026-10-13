"use server";

import { revalidatePath } from "next/cache";
import { Types } from "mongoose";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { Sale } from "@/lib/models/Sale";
import { Customer } from "@/lib/models/Customer";
import { getCustomerCredit, nextSaleReferenceId } from "@/lib/credit";
import { logActivity } from "@/lib/audit";
import { canWriteSale, resolveDepartmentsFromMapping, upsertDepartmentMapping } from "@/lib/pendingBillsData";
import { ENTRY_ROLES, assigneeForNewRow, primaryRole } from "@/lib/nav";
import { routeReference, extractBillNumber } from "@/lib/pendingBills";
import { getBranchRoutes } from "@/lib/branchesData";
import type { ActionResult, Role } from "@/lib/types";

export async function createSale(
  _prev: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await requireRole(...ENTRY_ROLES);

  const customerId = String(formData.get("customerId") ?? "").trim();
  const saleDateRaw = String(formData.get("saleDate") ?? "").trim();
  const amount = Number(formData.get("amount"));
  const manualRef = String(formData.get("referenceId") ?? "").trim();
  const billNo = String(formData.get("billNo") ?? "").trim();
  const billDateRaw = String(formData.get("billDate") ?? "").trim();
  const manualDepartmentsRaw = String(formData.get("manualDepartments") ?? "").trim();
  const manualDepartments = manualDepartmentsRaw
    ? manualDepartmentsRaw.split(",").filter((d): d is Role => ["sales", "consumable", "eid", "esbd", "branches"].includes(d))
    : undefined;

  if (!customerId || !saleDateRaw) {
    return { ok: false, error: "Customer and sale date are required." };
  }
  if (!billNo) {
    return { ok: false, error: "Bill number is required." };
  }
  if (!billDateRaw) {
    return { ok: false, error: "Bill date is required." };
  }
  if (Number.isNaN(new Date(saleDateRaw).getTime())) {
    return { ok: false, error: "Sale date is invalid." };
  }
  if (Number.isNaN(new Date(billDateRaw).getTime())) {
    return { ok: false, error: "Bill date is invalid." };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Sale amount must be a positive number." };
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
        error: `"${customer.name}" is pending approval and cannot be used for sales.`,
      };
    }

    const referenceId = manualRef || (await nextSaleReferenceId());

    const clash = await Sale.findOne({ referenceId })
      .select({ _id: 1 })
      .lean()
      .exec();
    if (clash) {
      return { ok: false, error: `Reference ID ${referenceId} already exists.` };
    }

    // Resolve departments using mapping database (with auto-fallback).
    // For sales, the bill number is in the `billNo` field.
    // If user manually overrode, use their selection and save the mapping.
    const branches = await getBranchRoutes();
    let departments: Role[];
    let billNumber: string;

    if (manualDepartments && manualDepartments.length > 0) {
      departments = manualDepartments;
      billNumber = extractBillNumber(billNo) ?? billNo;
      // Save the manual override to mapping database
      await upsertDepartmentMapping(billNumber, departments, user.id, true);
    } else {
      const resolved = await resolveDepartmentsFromMapping(billNo, branches, user.id);
      departments = resolved.departments;
      billNumber = resolved.billNumber;
    }

    const routed = routeReference(billNo, branches);
    // Override departments with resolved ones (mapping or auto)
    routed.departments = departments;

    const doc = await Sale.create({
      referenceId,
      customerId,
      saleDate: new Date(saleDateRaw),
      amount,
      billNo,
      billDate: new Date(billDateRaw),
      departments,
      ...(routed.branchId
        ? {
            branchId: new Types.ObjectId(routed.branchId),
            branchName: routed.branchName,
          }
        : {}),
      entryBy: user.name,
      createdBy: new Types.ObjectId(user.id),
      createdByRole: primaryRole(user.roles),
      // A sales user's own sales-routed row lands on their desk so they can see
      // it; an Accounts-entered one waits to be distributed.
      ...(assigneeForNewRow(user.roles, user.id, departments)
        ? { assignedTo: new Types.ObjectId(user.id) }
        : {}),
    });

    const credit = await getCustomerCredit(customerId);

    await logActivity({
      user,
      action: "create",
      module: "sales",
      recordId: String(doc._id),
      detail: `Sale ${referenceId} · ৳${amount} · ${credit?.name ?? customerId} · entered by ${user.name} (${primaryRole(user.roles)})`,
    });

    revalidatePath("/", "layout");
    return {
      ok: true,
      id: String(doc._id),
      error:
        credit && credit.status === "overdue"
          ? `Warning: ${credit.name} is OVERDUE — ${credit.overdueAmount.toLocaleString("en-BD")} ৳ unpaid past the ${credit.creditLimitDays}-day term (${credit.daysOverdue} day(s) late).`
          : undefined,
    };
  } catch (err) {
    console.error("createSale", err);
    return { ok: false, error: "Failed to create sale." };
  }
}

export async function updateSale(
  _prev: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await requireRole(...ENTRY_ROLES);

  const id = String(formData.get("id") ?? "").trim();
  const customerId = String(formData.get("customerId") ?? "").trim();
  const saleDateRaw = String(formData.get("saleDate") ?? "").trim();
  const amount = Number(formData.get("amount"));
  const manualRef = String(formData.get("referenceId") ?? "").trim();
  const billNo = String(formData.get("billNo") ?? "").trim();
  const billDateRaw = String(formData.get("billDate") ?? "").trim();
  const manualDepartmentsRaw = String(formData.get("manualDepartments") ?? "").trim();
  const manualDepartments = manualDepartmentsRaw
    ? manualDepartmentsRaw.split(",").filter((d): d is Role => ["sales", "consumable", "eid", "esbd", "branches"].includes(d))
    : undefined;

  if (!id || !customerId || !saleDateRaw) {
    return { ok: false, error: "Customer and sale date are required." };
  }
  if (!billNo) {
    return { ok: false, error: "Bill number is required." };
  }
  if (!billDateRaw) {
    return { ok: false, error: "Bill date is required." };
  }
  if (Number.isNaN(new Date(saleDateRaw).getTime())) {
    return { ok: false, error: "Sale date is invalid." };
  }
  if (Number.isNaN(new Date(billDateRaw).getTime())) {
    return { ok: false, error: "Bill date is invalid." };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Sale amount must be a positive number." };
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
        error: `"${customer.name}" is pending approval and cannot be used for sales.`,
      };
    }

    const referenceId = manualRef || (await nextSaleReferenceId());

    const clash = await Sale.findOne({ referenceId, _id: { $ne: id } })
      .select({ _id: 1 })
      .lean()
      .exec();
    if (clash) {
      return { ok: false, error: `Reference ID ${referenceId} already exists.` };
    }

    const before = await Sale.findById(id).lean().exec();
    if (!before) {
      return { ok: false, error: "Sale not found." };
    }
    // Reachable by a hand-typed id, so the list's scope has to be re-checked here
    // or a sales user could edit any sales-routed sale without ever seeing it.
    if (!canWriteSale(user, before.departments, before.assignedTo)) {
      return {
        ok: false,
        error: "That sale is not on your list, so you cannot edit it.",
      };
    }

    // Resolve departments using mapping database (with auto-fallback).
    // For sales, the bill number is in the `billNo` field.
    // If user manually overrode, use their selection and save the mapping.
    const branches = await getBranchRoutes();
    let departments: Role[];
    let billNumber: string;

    if (manualDepartments && manualDepartments.length > 0) {
      departments = manualDepartments;
      billNumber = extractBillNumber(billNo) ?? billNo;
      // Save the manual override to mapping database
      await upsertDepartmentMapping(billNumber, departments, user.id, true);
    } else {
      const resolved = await resolveDepartmentsFromMapping(billNo, branches, user.id);
      departments = resolved.departments;
      billNumber = resolved.billNumber;
    }

    const routed = routeReference(billNo, branches);
    // Override departments with resolved ones (mapping or auto)
    routed.departments = departments;

    await Sale.updateOne(
      { _id: id },
      {
        $set: {
          referenceId,
          customerId,
          saleDate: new Date(saleDateRaw),
          amount,
          billNo,
          billDate: new Date(billDateRaw),
          departments,
          ...(routed.branchId
            ? {
                branchId: new Types.ObjectId(routed.branchId),
                branchName: routed.branchName,
              }
            : {}),
        },
        $unset: routed.branchId ? {} : { branchId: 1, branchName: 1 },
      }
    );

    await logActivity({
      user,
      action: "update",
      module: "sales",
      recordId: id,
      detail: `Updated sale ${referenceId} · ৳${amount} · ${customer.name} · by ${user.name} (${primaryRole(user.roles)})`,
    });

    revalidatePath("/", "layout");
    return { ok: true, id };
  } catch (err) {
    console.error("updateSale", err);
    return { ok: false, error: "Failed to update sale." };
  }
}

export async function deleteSale(
  _prev: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await requireRole(...ENTRY_ROLES);

  const id = String(formData.get("id") ?? "").trim();
  if (!id) {
    return { ok: false, error: "Sale id is required." };
  }

  try {
    await db();
    const found = await Sale.findById(id)
      .select({ referenceId: 1, customerId: 1, departments: 1, assignedTo: 1 })
      .lean()
      .exec();
    if (!found) {
      return { ok: false, error: "Sale not found." };
    }
    if (!canWriteSale(user, found.departments, found.assignedTo)) {
      return {
        ok: false,
        error: "That sale is not on your list, so you cannot delete it.",
      };
    }

    const removed = await Sale.findByIdAndDelete(id).lean().exec();
    if (!removed) {
      return { ok: false, error: "Sale not found." };
    }

    await logActivity({
      user,
      action: "delete",
      module: "sales",
      recordId: id,
      detail: `Deleted sale ${removed.referenceId} · by ${user.name} (${primaryRole(user.roles)})`,
    });

    revalidatePath("/", "layout");
    return { ok: true, id };
  } catch (err) {
    console.error("deleteSale", err);
    return { ok: false, error: "Failed to delete sale." };
  }
}
