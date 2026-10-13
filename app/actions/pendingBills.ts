"use server";

import { revalidatePath } from "next/cache";
import { Types } from "mongoose";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { PendingBill } from "@/lib/models/PendingBill";
import { Customer } from "@/lib/models/Customer";
import { logActivity } from "@/lib/audit";
import { PENDING_BILL_ROLES, assigneeForNewRow, pendingBillHome, primaryRole } from "@/lib/nav";
import { daysSinceBill, deriveFromReference, parseReferenceNo, routeLabel, validateBillInput, type BillInput } from "@/lib/pendingBills";
import { readWorkbook, summariseRouting } from "@/lib/pendingBillsExcel";
import { canWriteBill, resolveDepartmentsFromMapping, upsertDepartmentMapping } from "@/lib/pendingBillsData";
import { getBranchRoutes } from "@/lib/branchesData";
import type { BranchRouteInput } from "@/lib/branches";
import { ensureCustomerForParty, resolvePartyCustomer } from "@/lib/partyCustomers";
import { formatDate, toDateInput } from "@/lib/format";
import type { ActionResult, Role } from "@/lib/types";

/** Shown on the list only while `pendingAmount > 0`, so saving a settled bill hides it. */
const SETTLED_WARNING =
  "Warning: pending amount is 0 — this bill was saved but stays hidden from the Pending Bills list (only bills with a pending amount are shown). Edit it to a positive amount to bring it back.";

function escapeRegex(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The branch fields for a write, or `null` when no branch matched.
 *
 * Spelled out rather than passing `branchId: undefined` because the UPDATE path
 * has to CLEAR a stale link: editing `IOM/BOG/W-038` → `TS-040` must not leave a
 * Bogura branch on a bill that now routes to Consumable. `$set: null` is how the
 * existing `customerId` link gets cleared, so the two follow the same shape.
 */
function branchFields(branchId?: string, branchName?: string) {
  return branchId
    ? { branchId: new Types.ObjectId(branchId), branchName: branchName ?? undefined }
    : null;
}

function branchUnset(hasBranch: boolean): Record<string, 1> {
  return hasBranch ? {} : { branchId: 1, branchName: 1 };
}


function readFields(formData: FormData): BillInput & { manualDepartments?: Role[] } {
  // Col G is a manual entry; a blank box means "not yet due" = 0.
  const rawOverdue = String(formData.get("overdueDays") ?? "").trim();
  const manualDepartmentsRaw = String(formData.get("manualDepartments") ?? "").trim();
  const manualDepartments = manualDepartmentsRaw
    ? manualDepartmentsRaw.split(",").filter((d): d is Role => ["sales", "consumable", "eid", "esbd", "branches"].includes(d))
    : undefined;

  return {
    billDate: String(formData.get("billDate") ?? "").trim(),
    referenceNo: String(formData.get("referenceNo") ?? "").trim(),
    partyName: String(formData.get("partyName") ?? "").trim(),
    openingAmount: Number(formData.get("openingAmount")),
    pendingAmount: Number(formData.get("pendingAmount")),
    dueOn: String(formData.get("dueOn") ?? "").trim(),
    overdueDays: rawOverdue === "" ? 0 : Number(rawOverdue),
    note: String(formData.get("note") ?? "").trim(),
    manualDepartments,
  };
}

export async function createPendingBill(
  _prev: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await requireRole(...PENDING_BILL_ROLES);

  const f = readFields(formData);
  const invalid = validateBillInput(f);
  if (invalid) return { ok: false, error: invalid };

  // Resolve departments using mapping database (with auto-fallback).
  // If user manually overrode, use their selection and save the mapping.
  const branches = await getBranchRoutes();
  let departments: Role[];
  let billNumber: string;

  if (f.manualDepartments && f.manualDepartments.length > 0) {
    departments = f.manualDepartments;
    billNumber = parseReferenceNo(f.referenceNo).billNumber ?? f.referenceNo.trim();
    // Save the manual override to mapping database
    await upsertDepartmentMapping(billNumber, departments, user.id, true);
  } else {
    const resolved = await resolveDepartmentsFromMapping(f.referenceNo, branches, user.id);
    departments = resolved.departments;
    billNumber = resolved.billNumber;
  }

  const derived = deriveFromReference(f.referenceNo, branches, departments);
  const warnings: string[] = [];
  const parsedRef = parseReferenceNo(f.referenceNo);
  if (parsedRef.embeddedDate && toDateInput(parsedRef.embeddedDate) !== f.billDate) {
    warnings.push(
      `Saved with a note: the reference says ${formatDate(parsedRef.embeddedDate)} but the bill date is ${f.billDate}.`
    );
  }
  if (f.manualDepartments && f.manualDepartments.length > 0) {
    warnings.push("Department manually set — this choice will be remembered for future entries with the same bill number.");
  }

  try {
    await db();

    // Resolve the party to a customer BEFORE the insert so the link can be
    // written in the same statement. Never fatal: a failure here must not lose
    // the bill the user just entered, so the row simply saves unlinked.
    let customerId: string | undefined;
    let partyCustomer = "customer already existed";
    try {
      const ensured = await ensureCustomerForParty(f.partyName, user);
      customerId = ensured.id || undefined;
      partyCustomer = ensured.created ? "customer created from this party" : "customer already existed";
    } catch (err) {
      console.error("ensureCustomerForParty", err);
      partyCustomer = "customer could not be created (bill still saved)";
    }

    const doc = await PendingBill.create({
      billDate: new Date(f.billDate),
      referenceNo: derived.referenceNo,
      billNumber: derived.billNumber,
      departments: derived.departments,
      ...(branchFields(derived.branchId, derived.branchName) ?? {}),
      partyName: f.partyName,
      customerId: customerId ? new Types.ObjectId(customerId) : undefined,
      openingAmount: f.openingAmount,
      pendingAmount: f.pendingAmount,
      dueOn: f.dueOn ? new Date(f.dueOn) : undefined,
      overdueDays: f.overdueDays,
      daysSinceBill: daysSinceBill(f.billDate, f.dueOn, f.overdueDays),
      note: f.note || undefined,
      entryBy: user.name,
      createdBy: new Types.ObjectId(user.id),
      createdByRole: primaryRole(user.roles),
      // A sales user's own Sales bill lands on their desk so they can see it; an
      // Accounts-entered one stays unassigned until it is distributed.
      ...(assigneeForNewRow(user.roles, user.id, derived.departments)
        ? { assignedTo: new Types.ObjectId(user.id) }
        : {}),
    });

    await logActivity({
      user,
      action: "create",
      module: "pendingBills",
      recordId: String(doc._id),
      detail: `Pending bill ${f.referenceNo} → ${routeLabel(derived.departments)} · ৳${f.pendingAmount} pending of ৳${f.openingAmount} · ${f.partyName} · ${f.overdueDays > 0 ? `${f.overdueDays}d overdue` : "within terms"} · entered by ${user.name} (${primaryRole(user.roles)}) · ${partyCustomer}`,
    });

    revalidatePath("/", "layout");
    return {
      ok: true,
      id: String(doc._id),
      home: pendingBillHome(derived.departments),
      error: [f.pendingAmount === 0 ? SETTLED_WARNING : "", ...warnings]
        .filter(Boolean)
        .join(" ") || undefined,
    };
  } catch (err) {
    console.error("createPendingBill", err);
    return { ok: false, error: "Failed to save pending bill." };
  }
}

export async function updatePendingBill(
  _prev: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await requireRole(...PENDING_BILL_ROLES);

  const id = String(formData.get("id") ?? "").trim();
  const f = readFields(formData);
  if (!id) return { ok: false, error: "Bill id is required." };

  const invalid = validateBillInput(f);
  if (invalid) return { ok: false, error: invalid };

  // Resolve departments using mapping database (with auto-fallback).
  // If user manually overrode, use their selection and save the mapping.
  const branches = await getBranchRoutes();
  let departments: Role[];
  let billNumber: string;

  if (f.manualDepartments && f.manualDepartments.length > 0) {
    departments = f.manualDepartments;
    billNumber = parseReferenceNo(f.referenceNo).billNumber ?? f.referenceNo.trim();
    // Save the manual override to mapping database
    await upsertDepartmentMapping(billNumber, departments, user.id, true);
  } else {
    const resolved = await resolveDepartmentsFromMapping(f.referenceNo, branches, user.id);
    departments = resolved.departments;
    billNumber = resolved.billNumber;
  }

  const derived = deriveFromReference(f.referenceNo, branches, departments);
  const branch = branchFields(derived.branchId, derived.branchName);

  try {
    await db();

    const before = await PendingBill.findById(id)
      .select({ referenceNo: 1, partyName: 1, departments: 1, assignedTo: 1 })
      .lean()
      .exec();
    if (!before) {
      return { ok: false, error: "Pending bill not found." };
    }
    // The row action and this form are reachable by a hand-typed id, so re-check
    // the department AND work-allocation scope the list query applies.
    if (!canWriteBill(user, before.departments, before.assignedTo)) {
      return {
        ok: false,
        error: "That bill is not on your list, so you cannot edit it.",
      };
    }

    // Re-resolve the link on every edit, so changing the party moves the link
    // with it instead of leaving the bill pointing at the old customer.
    let customerId: string | undefined;
    try {
      customerId = await resolvePartyCustomer(f.partyName, user);
    } catch (err) {
      console.error("resolvePartyCustomer", err);
    }

    // Re-deriving on update is what MOVES a bill between department apps when
    // its reference prefix changes (TS-1854 → S-1854), instead of forking it.
    // The same pass moves it in or out of a branch.
    await PendingBill.updateOne(
      { _id: id },
      {
        $set: {
          billDate: new Date(f.billDate),
          referenceNo: derived.referenceNo,
          billNumber: derived.billNumber,
          departments: derived.departments,
          ...(branch ?? {}),
          partyName: f.partyName,
          customerId: customerId ? new Types.ObjectId(customerId) : null,
          openingAmount: f.openingAmount,
          pendingAmount: f.pendingAmount,
          dueOn: f.dueOn ? new Date(f.dueOn) : undefined,
          overdueDays: f.overdueDays,
      daysSinceBill: daysSinceBill(f.billDate, f.dueOn, f.overdueDays),
          note: f.note || undefined,
        },
        $unset: branchUnset(!!branch),
      }
    );

    const movedFrom = routeLabel(before.departments ?? []);
    const movedTo = routeLabel(derived.departments);
    const move = movedFrom !== movedTo ? ` · rerouted ${movedFrom} → ${movedTo}` : "";

    await logActivity({
      user,
      action: "update",
      module: "pendingBills",
      recordId: id,
      detail: `Updated pending bill ${before.referenceNo} → ${f.referenceNo} · ${f.partyName} · ৳${f.pendingAmount} pending · ${f.overdueDays > 0 ? `${f.overdueDays}d overdue` : "within terms"}${move} · by ${user.name} (${primaryRole(user.roles)})`,
    });

    revalidatePath("/", "layout");
    return {
      ok: true,
      id,
      home: pendingBillHome(derived.departments),
      error: f.pendingAmount === 0 ? SETTLED_WARNING : undefined,
    };
  } catch (err) {
    console.error("updatePendingBill", err);
    return { ok: false, error: "Failed to update pending bill." };
  }
}

/** A party's outstanding bill, flattened for the Add Payment summary card. */
export type PartyBillSummary = {
  id: string;
  billDate: string;
  referenceNo: string;
  billNumber: string;
  openingAmount: number;
  pendingAmount: number;
  dueOn: string;
  overdueDays: number;
  note: string;
  routedTo: string;
};

export type PartyBillsResult = {
  bills: PartyBillSummary[];
  /** Sum of the returned `pendingAmount` values. */
  totalPending: number;
  /** Part of `totalPending` sitting on bills the user typed as overdue. */
  totalOverdue: number;
  count: number;
  /** Bills exist for this party but every one is settled. */
  allSettled: boolean;
  /** How the party was matched, so the UI can be honest about the join. */
  matchedBy: "customerId" | "name" | "none";
};

/**
 * Outstanding pending bills for one party, for the Add Payment summary card.
 *
 * Deliberately NOT department-scoped: this is a credit-side lookup about what a
 * party still owes, and the register is shared across the department apps, so
 * narrowing it by the viewer's department would hide bills the payment is
 * presumably settling. The caller only ever receives figures for a party it
 * already picked.
 *
 * `pendingAmount: { $gt: 0 }` matches the list query — a settled bill has
 * nothing left to show. Bills are matched on `customerId` when available and
 * fall back to a case-insensitive whole-name match so pre-link rows (and bills
 * whose customer creation failed) still surface.
 */
export async function getPartyPendingBills(
  customerId: string
): Promise<PartyBillsResult> {
  const empty: PartyBillsResult = {
    bills: [],
    totalPending: 0,
    totalOverdue: 0,
    count: 0,
    allSettled: false,
    matchedBy: "none",
  };

  const id = customerId.trim();
  if (!Types.ObjectId.isValid(id)) return empty;

  try {
    // Any role that can record a payment may read the party's position.
    const user = await requireRole(...PENDING_BILL_ROLES);
    void user;

    await db();

    const customer = await Customer.findById(id)
      .select({ name: 1 })
      .lean()
      .exec();
    if (!customer) return empty;

    const byId = await PendingBill.find({
      customerId: new Types.ObjectId(id),
      pendingAmount: { $gt: 0 },
    })
      .sort({ billDate: 1 })
      .lean()
      .exec();

    // Legacy / unlinked rows: same party by name, but no usable customerId.
    const linkedIds = new Set(byId.map((b) => String(b._id)));
    const byName = await PendingBill.find({
      partyName: new RegExp(`^${escapeRegex(customer.name)}$`, "i"),
      pendingAmount: { $gt: 0 },
      $or: [{ customerId: { $exists: false } }, { customerId: null }],
    })
      .sort({ billDate: 1 })
      .lean()
      .exec();

    const docs = [...byId, ...byName.filter((b) => !linkedIds.has(String(b._id)))].sort(
      (a, b) => a.billDate.getTime() - b.billDate.getTime()
    );

    const bills: PartyBillSummary[] = docs.map((b) => ({
      id: String(b._id),
      billDate: toDateInput(b.billDate),
      referenceNo: b.referenceNo,
      billNumber: b.billNumber ?? "",
      openingAmount: b.openingAmount,
      pendingAmount: b.pendingAmount,
      dueOn: b.dueOn ? toDateInput(b.dueOn) : "",
      overdueDays: b.overdueDays ?? 0,
      note: b.note ?? "",
      routedTo: routeLabel(b.departments),
    }));

    const totalPending = bills.reduce((sum, b) => sum + b.pendingAmount, 0);
    const totalOverdue = bills.reduce(
      (sum, b) => sum + (b.overdueDays > 0 ? b.pendingAmount : 0),
      0
    );

    // `allSettled` distinguishes "party has no bills" from "party's bills are
    // all paid off" — the card says something different in each case.
    const anyForParty = bills.length
      ? true
      : (await PendingBill.countDocuments({
          $or: [
            { customerId: new Types.ObjectId(id) },
            { partyName: new RegExp(`^${escapeRegex(customer.name)}$`, "i") },
          ],
        })) > 0;

    return {
      bills,
      totalPending,
      totalOverdue,
      count: bills.length,
      allSettled: !bills.length && anyForParty,
      matchedBy: bills.length ? (byId.length ? "customerId" : "name") : "none",
    };
  } catch (err) {
    console.error("getPartyPendingBills", err);
    return empty;
  }
}

/** One of a party's existing bills, offered as a suggestion while entering a new one. */
export type PartyBillSuggestion = {
  id: string;
  referenceNo: string;
  billNumber: string;
  billDate: string;
  openingAmount: number;
  pendingAmount: number;
  overdueDays: number;
};

export type PartyBillSuggestionsResult = {
  bills: PartyBillSuggestion[];
  /** How many bills the party has in total, so the UI can say "showing 25 of 63". */
  total: number;
};

/** Cap the picker: this is a "have I got this bill already?" helper, not a register. */
const SUGGEST_LIMIT = 25;

/**
 * A party's existing bills, to suggest on the Pending Bill form.
 *
 * Keyed on the free-text `partyName` rather than a Customer id, because that field
 * is a datalist of suggestions and the user can type a party that has no Customer
 * yet. Matching is the same case-insensitive whole-name rule as
 * `lib/partyCustomers.ts`, widened to `customerId` when the party does resolve to
 * a Customer — that catches a bill whose `partyName` copy drifted from its link.
 *
 * Returns outstanding AND settled bills: when checking whether a bill is already
 * registered, a settled one is exactly the row you want to find.
 */
export async function getPartyBillSuggestions(
  partyName: string
): Promise<PartyBillSuggestionsResult> {
  const name = partyName.trim();
  if (!name) return { bills: [], total: 0 };

  try {
    // Any role that can register a bill may look one up.
    await requireRole(...PENDING_BILL_ROLES);
    await db();

    const nameRe = new RegExp(`^${escapeRegex(name)}$`, "i");
    const customer = await Customer.findOne({ name: nameRe })
      .select({ _id: 1 })
      .lean()
      .exec();

    // `$or` MUST sit at the top level of the query — nesting it under a field is a
    // MongoServerError.
    const clauses: Record<string, unknown>[] = [{ partyName: nameRe }];
    if (customer) clauses.push({ customerId: customer._id });

    const [docs, total] = await Promise.all([
      PendingBill.find({ $or: clauses })
        .sort({ billDate: -1 })
        .limit(SUGGEST_LIMIT)
        .select({
          referenceNo: 1,
          billNumber: 1,
          billDate: 1,
          openingAmount: 1,
          pendingAmount: 1,
          overdueDays: 1,
        })
        .lean()
        .exec(),
      PendingBill.countDocuments({ $or: clauses }),
    ]);

    return {
      bills: docs.map((b) => ({
        id: String(b._id),
        referenceNo: b.referenceNo,
        billNumber: b.billNumber ?? "",
        billDate: toDateInput(b.billDate),
        openingAmount: b.openingAmount,
        pendingAmount: b.pendingAmount,
        overdueDays: b.overdueDays ?? 0,
      })),
      total,
    };
  } catch (err) {
    console.error("getPartyBillSuggestions", err);
    return { bills: [], total: 0 };
  }
}

export async function deletePendingBill(
  _prev: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await requireRole(...PENDING_BILL_ROLES);

  const id = String(formData.get("id") ?? "").trim();
  if (!id) {
    return { ok: false, error: "Bill id is required." };
  }

  try {
    await db();
    // Read the routing BEFORE deleting — the same department + allocation check
    // `update` applies, so a Consumable user cannot delete a Sales or unrouted
    // bill, and a sales user cannot delete a bill assigned to somebody else.
    const found = await PendingBill.findById(id)
      .select({ referenceNo: 1, partyName: 1, departments: 1, assignedTo: 1 })
      .lean()
      .exec();
    if (!found) {
      return { ok: false, error: "Pending bill not found." };
    }
    if (!canWriteBill(user, found.departments, found.assignedTo)) {
      return {
        ok: false,
        error: "That bill is not on your list, so you cannot delete it.",
      };
    }

    const removed = await PendingBill.findByIdAndDelete(id).lean().exec();
    if (!removed) {
      return { ok: false, error: "Pending bill not found." };
    }

    await logActivity({
      user,
      action: "delete",
      module: "pendingBills",
      recordId: id,
      detail: `Deleted pending bill ${removed.referenceNo} · ${removed.partyName} · by ${user.name} (${primaryRole(user.roles)})`,
    });

    revalidatePath("/", "layout");
    return { ok: true, id };
  } catch (err) {
    console.error("deletePendingBill", err);
    return { ok: false, error: "Failed to delete pending bill." };
  }
}

export async function addFollowUp(
  _prev: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult & { count?: number }> {
  // `eid_juniors` is listed explicitly (not added to PENDING_BILL_ROLES) so it
  // gains ONLY this action — create/update/delete/import stay closed.
  const user = await requireRole(...PENDING_BILL_ROLES, "eid_juniors");

  const id = String(formData.get("id") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  const etaRaw = String(formData.get("estimatedPaymentDate") ?? "").trim();
  if (!id) {
    return { ok: false, error: "Bill id is required." };
  }
  if (!note) {
    return { ok: false, error: "Follow-up note is required." };
  }
  if (note.length > 500) {
    return { ok: false, error: "Note must be 500 characters or fewer." };
  }
  // Optional: plenty of calls end with no commitment at all. Same parsing as
  // `dueOn` — a bare `YYYY-MM-DD` from a date input, stored as UTC midnight.
  const estimatedPaymentDate = etaRaw ? new Date(etaRaw) : null;
  if (estimatedPaymentDate && Number.isNaN(estimatedPaymentDate.getTime())) {
    return { ok: false, error: "Estimated payment date is not a valid date." };
  }

  try {
    await db();
    const bill = await PendingBill.findById(id)
      .select({
        referenceNo: 1,
        partyName: 1,
        departments: 1,
        assignedTo: 1,
        followUps: 1,
        pendingAmount: 1,
      })
      .lean()
      .exec();
    if (!bill) {
      return { ok: false, error: "Pending bill not found." };
    }
    if (!canWriteBill(user, bill.departments, bill.assignedTo)) {
      return {
        ok: false,
        error: "That bill is not on your list, so you cannot follow up on it.",
      };
    }
    // The panel is only rendered on the outstanding list, but the id is
    // hand-typeable, so re-check it here. A settled bill is done with.
    if (bill.pendingAmount <= 0) {
      return {
        ok: false,
        error: "This bill is already settled, so it cannot take another follow-up.",
      };
    }

    const count = (bill.followUps?.length ?? 0) + 1;
    await PendingBill.updateOne(
      { _id: id },
      {
        $push: {
          followUps: {
            date: new Date(),
            note,
            estimatedPaymentDate: estimatedPaymentDate ?? null,
            createdBy: new Types.ObjectId(user.id),
            createdByRole: primaryRole(user.roles),
          },
        },
      }
    );

    const promise = estimatedPaymentDate ? ` · promised ${formatDate(estimatedPaymentDate)}` : "";
    await logActivity({
      user,
      action: "follow_up",
      module: "pendingBills",
      recordId: id,
      detail: `Follow-up #${count} on ${bill.referenceNo} (${bill.partyName}) · "${note.slice(0, 80)}"${promise} · by ${user.name} (${primaryRole(user.roles)})`,
    });

    revalidatePath("/", "layout");
    return { ok: true, id, count };
  } catch (err) {
    console.error("addFollowUp", err);
    return { ok: false, error: "Failed to add follow-up." };
  }
}

/** Plain form-action wrapper (single FormData arg) for the table Trash button. */
export async function deletePendingBillAction(formData: FormData): Promise<void> {
  await deletePendingBill(undefined, formData);
}

/* ------------------------------------------------------------------ */
/* Excel import                                                         */
/* ------------------------------------------------------------------ */

export type PendingBillImportResult = {
  ok: boolean;
  error?: string;
  created: number;
  updated: number;
  skipped: number;
  /** Distinct parties that did not have a customer yet and now do. */
  customersCreated: number;
  /** Hard failures, one per skipped row, keyed by sheet row number. */
  errors: string[];
  /** Advisory notes (ref-no parse, unrouted prefix) — the row WAS imported. */
  warnings: string[];
  /** Where the imported rows actually landed, e.g. { "Sales": 4 }. */
  routing: Record<string, number>;
  mappingNote?: string;
  home?: string;
};

const EMPTY_IMPORT: PendingBillImportResult = {
  ok: false,
  created: 0,
  updated: 0,
  skipped: 0,
  customersCreated: 0,
  errors: [],
  warnings: [],
  routing: {},
};

/**
 * Find the existing row this import line refers to.
 *
 * Primary key is the EXTRACTED BILL NUMBER + party, not the whole reference, so
 * correcting the embedded date (`dt.14.3.2026` → `dt.15.3.2026`) updates the
 * same bill rather than creating a second one. A reference-quoted lookup is the
 * second chance, which is what rescues rows written before `billNumber` existed.
 *
 * `branches` is passed in rather than loaded here: this runs once per row, so a
 * 5000-row file must not turn into 5000 branch queries. It is also the second of
 * the TWO `deriveFromReference` calls per imported row, and forgetting it here
 * leaves the lookup keyed on pre-branch routing.
 */
async function findExisting(
  referenceNo: string,
  partyName: string,
  branches: BranchRouteInput[]
) {
  const derived = deriveFromReference(referenceNo, branches);
  const partyRe = new RegExp(`^${escapeRegex(partyName.trim())}$`, "i");

  if (derived.billNumber) {
    const byNumber = await PendingBill.findOne({
      billNumber: derived.billNumber,
      partyName: partyRe,
    })
      .select({ _id: 1 })
      .lean()
      .exec();
    if (byNumber) return byNumber;
  }

  return PendingBill.findOne({
    referenceNo: new RegExp(`^${escapeRegex(derived.referenceNo)}$`, "i"),
    partyName: partyRe,
  })
    .select({ _id: 1 })
    .lean()
    .exec();
}

export async function importPendingBills(
  _prev: PendingBillImportResult | undefined,
  formData: FormData
): Promise<PendingBillImportResult> {
  const user = await requireRole(...PENDING_BILL_ROLES);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ...EMPTY_IMPORT, error: "Choose an .xlsx file to import." };
  }
  if (!/\.xlsx$/i.test(file.name)) {
    return {
      ...EMPTY_IMPORT,
      error: `"${file.name}" is not an .xlsx file. Export the register first, then re-import that file.`,
    };
  }

  let parsed;
  try {
    parsed = await readWorkbook(await file.arrayBuffer());
  } catch (err) {
    return {
      ...EMPTY_IMPORT,
      error: err instanceof Error ? err.message : "That file could not be read.",
    };
  }

  if (!parsed.rows.length) {
    return {
      ...EMPTY_IMPORT,
      error: `No bill rows were found in "${file.name}". Download the template to see the expected columns.`,
    };
  }

  await db();

  const result: PendingBillImportResult = {
    ok: true,
    created: 0,
    updated: 0,
    skipped: 0,
    customersCreated: 0,
    errors: [],
    warnings: [],
    routing: {},
    mappingNote: parsed.mappingNote,
  };
  const landed: { referenceNo: string; departments: Role[] }[] = [];
  // One customer per DISTINCT party in the file, not one lookup per row.
  const partyCustomer = new Map<string, string>();
  // Routing derives TWICE per row (here and inside findExisting), so the branch
  // list is fetched exactly once for the whole file.
  const branchRoutes = await getBranchRoutes();

  for (const row of parsed.rows) {
    if (row.error || !row.input) {
      result.skipped += 1;
      result.errors.push(`Row ${row.rowNumber} (${row.label}): ${row.error}`);
      continue;
    }

    const input = row.input;
    // Resolve departments using mapping database (with auto-fallback) for import
    const resolved = await resolveDepartmentsFromMapping(input.referenceNo, branchRoutes, user.id);
    const derived = deriveFromReference(input.referenceNo, branchRoutes, resolved.departments);
    const branch = branchFields(derived.branchId, derived.branchName);
    const existing = await findExisting(input.referenceNo, input.partyName, branchRoutes);

    // Resolve the party to a customer first so the link lands in the same write.
    // Same party on two rows must not create two customers, so cache per file.
    const partyKey = input.partyName.trim().toLowerCase();
    if (!partyCustomer.has(partyKey)) {
      try {
        const ensured = await ensureCustomerForParty(input.partyName, user, 0);
        if (ensured.created) result.customersCreated += 1;
        partyCustomer.set(partyKey, ensured.id);
      } catch (err) {
        console.error("ensureCustomerForParty", err);
        result.warnings.push(
          `Row ${row.rowNumber} (${row.label}): the bill was imported but a customer could not be created for this party.`
        );
        partyCustomer.set(partyKey, "");
      }
    }
    const customerId = partyCustomer.get(partyKey) || "";
    // `create` rejects null, and `$set: null` is how a link gets CLEARED, so the
    // two branches are spelled out rather than sharing one object.
    const link = customerId ? { customerId: new Types.ObjectId(customerId) } : {};

    const $set = {
      billDate: new Date(input.billDate),
      referenceNo: derived.referenceNo,
      billNumber: derived.billNumber,
      departments: derived.departments,
      ...(branch ?? {}),
      partyName: input.partyName,
      openingAmount: input.openingAmount,
      pendingAmount: input.pendingAmount,
      dueOn: input.dueOn ? new Date(input.dueOn) : undefined,
      overdueDays: input.overdueDays,
      daysSinceBill: daysSinceBill(input.billDate, input.dueOn, input.overdueDays),
      note: input.note || undefined,
    };

    if (existing) {
      // An update keeps the original author — the importing user is not the owner
      // — and must NOT touch `assignedTo`, or re-importing a distributed file
      // would quietly pull every row back off its assignee's desk. A row that no
      // longer matches any branch prefix has its branch link cleared rather than
      // left pointing at a branch the reference no longer claims.
      const update: Record<string, unknown> = {
        $set: { ...$set, ...link },
        $unset: { ...branchUnset(!!branch) },
      };
      if (!customerId) update.$unset = { ...(update.$unset as object), customerId: 1 };
      await PendingBill.updateOne({ _id: existing._id }, update);
      result.updated += 1;
    } else {
      await PendingBill.create({
        ...$set,
        ...link,
        entryBy: user.name,
        createdBy: new Types.ObjectId(user.id),
        createdByRole: primaryRole(user.roles),
        // Insert only, same reason as above: a sales user's own `S-` rows are
        // theirs from the moment they are created.
        ...(assigneeForNewRow(user.roles, user.id, derived.departments)
          ? { assignedTo: new Types.ObjectId(user.id) }
          : {}),
      });
      result.created += 1;
    }

    landed.push({ referenceNo: input.referenceNo, departments: derived.departments });
    for (const w of row.warnings) {
      result.warnings.push(`Row ${row.rowNumber} (${row.label}): ${w}`);
    }
  }

  result.routing = summariseRouting(landed);

  await logActivity({
    user,
    action: "import",
    module: "pendingBills",
    detail: `Imported "${file.name}" · ${result.created} created, ${result.updated} updated, ${result.skipped} skipped · ${result.customersCreated} new customers from parties · ${Object.entries(result.routing)
      .map(([k, v]) => `${v} → ${k}`)
      .join(", ")}`,
  });

  revalidatePath("/", "layout");
  // A Consumable user importing a mixed file may have created Sales bills, so
  // send them back to the app that owns what they actually wrote.
  const firstDepartments = landed[0]?.departments ?? [];
  return {
    ...result,
    home: pendingBillHome(firstDepartments.length === 1 ? firstDepartments : []),
  };
}

