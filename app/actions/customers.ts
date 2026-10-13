"use server";

import { revalidatePath } from "next/cache";
import { Types } from "mongoose";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { Customer } from "@/lib/models/Customer";
import { Sale } from "@/lib/models/Sale";
import { Payment } from "@/lib/models/Payment";
import { PendingBill } from "@/lib/models/PendingBill";
import { logActivity } from "@/lib/audit";
import { readCustomerWorkbook } from "@/lib/customersExcel";
import { DEFAULT_CUSTOMER_GROUP, type ActionResult } from "@/lib/types";
import { ENTRY_ROLES, primaryRole } from "@/lib/nav";

export async function createCustomer(
  _prev: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await requireRole(...ENTRY_ROLES, "admin");

  const name = String(formData.get("name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const contactPerson = String(formData.get("contactPerson") ?? "").trim();
  const contactNumber = String(formData.get("contactNumber") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  const group = String(formData.get("group") ?? "").trim() || DEFAULT_CUSTOMER_GROUP;
  const creditLimitDays = parseOptionalDays(formData.get("creditLimitDays"));
  const branch = String(formData.get("branch") ?? "").trim();

  if (!name) {
    return { ok: false, error: "Customer name is required." };
  }
  if (creditLimitDays !== null && (!Number.isFinite(creditLimitDays) || creditLimitDays < 0)) {
    return { ok: false, error: "Credit limit must be a positive number of days." };
  }
  const term = readTermOverride(formData);
  if (term.error) return { ok: false, error: term.error };

  try {
    await db();
    const doc = await Customer.create({
      name,
      address: address || undefined,
      contactPerson: contactPerson || undefined,
      contactNumber: contactNumber || undefined,
      category: category || undefined,
      group,
      creditLimitDays,
      termMinDays: term.min,
      termMaxDays: term.max,
      branch: branch || undefined,
      createdBy: new Types.ObjectId(user.id),
      createdByRole: primaryRole(user.roles),
      approvalStatus: "pending",
    });

    await logActivity({
      user,
      action: "create",
      module: "customers",
      recordId: String(doc._id),
      detail: `Submitted customer ${name} (pending approval) via ${primaryRole(user.roles)} department`,
    });

    revalidatePath("/", "layout");
    return { ok: true, id: String(doc._id) };
  } catch (err) {
    console.error("createCustomer", err);
    return { ok: false, error: "Failed to create customer." };
  }
}

export async function approveCustomer(
  _prev: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await requireRole("admin");
  const id = String(formData.get("id") ?? "").trim();

  if (!id) {
    return { ok: false, error: "Customer id is required." };
  }

  try {
    await db();
    const customer = await Customer.findById(id).lean().exec();
    if (!customer) {
      return { ok: false, error: "Customer not found." };
    }
    if (customer.approvalStatus === "approved") {
      return { ok: false, error: "Customer is already approved." };
    }

    await Customer.updateOne(
      { _id: id },
      {
        $set: {
          approvalStatus: "approved",
          approvedBy: new Types.ObjectId(user.id),
          approvedByName: user.name,
          approvedAt: new Date(),
        },
      }
    );

    await logActivity({
      user,
      action: "update",
      module: "customers",
      recordId: id,
      detail: `Approved customer ${customer.name}`,
    });

    revalidatePath("/", "layout");
    return { ok: true, id };
  } catch (err) {
    console.error("approveCustomer", err);
    return { ok: false, error: "Failed to approve customer." };
  }
}

/** Plain form-action wrapper (single FormData arg) for table Approve buttons. */
export async function approveCustomerAction(formData: FormData): Promise<void> {
  await approveCustomer(undefined, formData);
}

/* ------------------------------------------------------------------ */
/* Edit + delete                                                       */
/* ------------------------------------------------------------------ */

function readProfile(formData: FormData) {
  return {
    name: String(formData.get("name") ?? "").trim(),
    address: String(formData.get("address") ?? "").trim(),
    contactPerson: String(formData.get("contactPerson") ?? "").trim(),
    contactNumber: String(formData.get("contactNumber") ?? "").trim(),
    category: String(formData.get("category") ?? "").trim(),
    group: String(formData.get("group") ?? "").trim() || DEFAULT_CUSTOMER_GROUP,
    branch: String(formData.get("branch") ?? "").trim(),
    creditLimitDays: parseOptionalDays(formData.get("creditLimitDays")),
  };
}

/**
 * Blank box → `null` (automatic: the term display falls through to the
 * Min/Max override, then the range derived from open bills). The raw string
 * is checked first because `Number("")` is `0`, and 0 is a REAL term (due the
 * day it was billed) — blank must never be saved as that. Note: the term
 * DISPLAY (`partyTermDays`) treats a stored 0 as unset and skips it; the
 * sales-overdue maths still uses the 0 as-is.
 */
function parseOptionalDays(v: FormDataEntryValue | null): number | null {
  const raw = String(v ?? "").trim();
  if (!raw) return null;
  return Number(raw);
}

function escapeRegex(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Read the optional hand-set term override.
 *
 * - both boxes blank → `{ min: null, max: null }` = AUTOMATIC: the Customers
 *   list derives the term live from the party's open bills, and a later
 *   pending-bill import re-derives it;
 * - Min only → a single number (`max: null` renders the same figure twice);
 * - Min + Max → the "7–30" spread.
 *
 * Once saved, the values are pinned on the Customer, which is the whole point:
 * an override must survive every future import.
 */
function readTermOverride(formData: FormData):
  | { min: number | null; max: number | null; error?: undefined }
  | { min: null; max: null; error: string } {
  const rawMin = String(formData.get("termMinDays") ?? "").trim();
  const rawMax = String(formData.get("termMaxDays") ?? "").trim();

  if (!rawMin && !rawMax) return { min: null, max: null };

  if (!rawMin && rawMax) {
    return {
      min: null,
      max: null,
      error: "Term override: enter Min days, or leave BOTH blank to keep the term automatic.",
    };
  }

  const min = Number(rawMin);
  const max = rawMax ? Number(rawMax) : null;
  if (!Number.isInteger(min) || min < 0 || (max !== null && (!Number.isInteger(max) || max < 0))) {
    return { min: null, max: null, error: "Term override must be whole days of 0 or more." };
  }
  if (max !== null && max < min) {
    return {
      min: null,
      max: null,
      error: `Term override: Max (${max}) cannot be smaller than Min (${min}).`,
    };
  }
  return { min, max };
}

/**
 * Reject a rename that would collide with another customer.
 *
 * This matters more than a normal duplicate check: `lib/partyCustomers.ts` links a
 * pending bill to a customer by CASE-INSENSITIVE WHOLE NAME. Two customers sharing
 * a name would make `ensureCustomerForParty` silently pick one of them, so the
 * link could point at the wrong record.
 */
async function nameTakenElsewhere(name: string, exceptId: string): Promise<boolean> {
  const clash = await Customer.findOne({
    name: new RegExp(`^${escapeRegex(name)}$`, "i"),
    _id: { $ne: exceptId },
  })
    .select({ _id: 1 })
    .lean()
    .exec();
  return !!clash;
}

export async function updateCustomer(
  _prev: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await requireRole(...ENTRY_ROLES, "admin");

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { ok: false, error: "Customer id is required." };

  const p = readProfile(formData);
  if (!p.name) return { ok: false, error: "Customer name is required." };
  if (p.creditLimitDays !== null && (!Number.isFinite(p.creditLimitDays) || p.creditLimitDays < 0)) {
    return { ok: false, error: "Credit limit must be a positive number of days." };
  }
  const term = readTermOverride(formData);
  if (term.error) return { ok: false, error: term.error };

  try {
    await db();

    const before = await Customer.findById(id).lean().exec();
    if (!before) return { ok: false, error: "Customer not found." };

    if (p.name.toLowerCase() !== before.name.toLowerCase()) {
      if (await nameTakenElsewhere(p.name, id)) {
        return {
          ok: false,
          error: `Another customer is already called "${p.name}". Names must be unique, because pending bills are linked to a customer by name.`,
        };
      }
    }

    // `approvalStatus` is deliberately NOT writable here — otherwise any entry
    // role could approve its own customer and bypass the admin-only workflow.
    await Customer.updateOne(
      { _id: id },
      {
        $set: {
          name: p.name,
          address: p.address || undefined,
          contactPerson: p.contactPerson || undefined,
          contactNumber: p.contactNumber || undefined,
          category: p.category || undefined,
          group: p.group,
          branch: p.branch || undefined,
          creditLimitDays: p.creditLimitDays,
          // Blank boxes clear the override back to automatic; saved values pin
          // the Customers-list cell against future pending-bill imports.
          termMinDays: term.min,
          termMaxDays: term.max,
        },
      }
    );

    // A rename must not orphan the pending-bill link: those rows carry both
    // `customerId` and a `partyName` copy, and the party lookup is by name.
    // Rewrite the copy so the two can never disagree.
    let relinked = 0;
    if (p.name !== before.name) {
      const res = await PendingBill.updateMany(
        { customerId: new Types.ObjectId(id) },
        { $set: { partyName: p.name } }
      );
      relinked = res.modifiedCount ?? 0;
    }

    await logActivity({
      user,
      action: "update",
      module: "customers",
      recordId: id,
      detail:
        p.name !== before.name
          ? `Renamed customer ${before.name} → ${p.name} (${relinked} pending bill(s) relinked)`
          : `Updated customer ${p.name} · ${
              term.min !== null
                ? `term override ${term.max !== null && term.max !== term.min ? `${term.min}–${term.max}` : term.min}d`
                : p.creditLimitDays !== null
                  ? `${p.creditLimitDays}d terms`
                  : "auto terms"
            } · by ${user.name} (${primaryRole(user.roles)})`,
    });

    revalidatePath("/", "layout");
    return { ok: true, id };
  } catch (err) {
    console.error("updateCustomer", err);
    return { ok: false, error: "Failed to update customer." };
  }
}

/** Plain form-action wrapper for the table Trash button. */
export async function updateCustomerAction(formData: FormData): Promise<void> {
  await updateCustomer(undefined, formData);
}

export async function deleteCustomer(
  _prev: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  // Delete is admin-only: it is the one irreversible thing in this module.
  const user = await requireRole("admin");

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { ok: false, error: "Customer id is required." };

  try {
    await db();

    const customer = await Customer.findById(id).lean().exec();
    if (!customer) return { ok: false, error: "Customer not found." };

    // Deleting a customer that money has passed through would leave Sales and
    // Payments rows pointing at nothing, silently dropping the party from every
    // outstanding/overdue total. Refuse and name the blocker instead.
    const [sales, payments, bills] = await Promise.all([
      Sale.countDocuments({ customerId: customer._id }),
      Payment.countDocuments({ customerId: customer._id }),
      PendingBill.countDocuments({ customerId: customer._id }),
    ]);

    const blockers: string[] = [];
    if (sales) blockers.push(`${sales} sale(s)`);
    if (payments) blockers.push(`${payments} payment(s)`);
    if (bills) blockers.push(`${bills} pending bill(s)`);
    if (blockers.length) {
      return {
        ok: false,
        error: `${customer.name} has ${blockers.join(", ")} against it, so it cannot be deleted — those records would lose their customer. Edit the details instead, or delete the transactions first.`,
      };
    }

    await Customer.deleteOne({ _id: id });

    await logActivity({
      user,
      action: "delete",
      module: "customers",
      recordId: id,
      detail: `Deleted customer ${customer.name} · by ${user.name} (${primaryRole(user.roles)})`,
    });

    revalidatePath("/", "layout");
    return { ok: true, id };
  } catch (err) {
    console.error("deleteCustomer", err);
    return { ok: false, error: "Failed to delete customer." };
  }
}

/** Plain form-action wrapper for the table Trash button. */
export async function deleteCustomerAction(formData: FormData): Promise<void> {
  await deleteCustomer(undefined, formData);
}

/* ------------------------------------------------------------------ */
/* Excel import                                                        */
/* ------------------------------------------------------------------ */

export type CustomerImportResult = {
  ok: boolean;
  error?: string;
  created: number;
  updated: number;
  skipped: number;
  /** Hard failures, one per skipped row, keyed by sheet row number. */
  errors: string[];
  /** Advisory notes — the row WAS imported. */
  warnings: string[];
  /** Human note about how the columns were resolved. */
  mappingNote?: string;
};

const EMPTY_IMPORT: CustomerImportResult = {
  ok: false,
  created: 0,
  updated: 0,
  skipped: 0,
  errors: [],
  warnings: [],
};

/**
 * Import customers from an .xlsx sheet (the same layout the Customers export
 * writes, or the downloadable template).
 *
 * A row is matched to an existing customer by CASE-INSENSITIVE WHOLE NAME — the
 * same identity `lib/partyCustomers.ts` uses to link a pending bill to a
 * customer, so an import can never fork a second record for a party that is
 * already payable. An existing customer has its details updated in place and
 * its `approvalStatus` is deliberately NOT written (same rule as
 * `updateCustomer`); a new name becomes a customer awaiting admin approval,
 * exactly as `createCustomer` would have made it.
 */
/**
 * A contact cell holding only `0` is NOT a value: Excel hands back a bare 0 for
 * an empty/zero-formatted number cell, and importing it would stamp the literal
 * "0" over a real contact. Treat it exactly like a blank — the column is
 * skipped and whatever is already stored stays put (a new customer just stays
 * blank). Real numbers survive, leading zeros included: `01711123456` is kept.
 */
function contactValue(v: string): string | undefined {
  const t = v.trim();
  if (!t || /^0(?:\.0+)?$/.test(t)) return undefined;
  return t;
}

export async function importCustomers(
  _prev: CustomerImportResult | undefined,
  formData: FormData
): Promise<CustomerImportResult> {
  const user = await requireRole(...ENTRY_ROLES, "admin");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ...EMPTY_IMPORT, error: "Choose an .xlsx file to import." };
  }
  if (!/\.xlsx$/i.test(file.name)) {
    return {
      ...EMPTY_IMPORT,
      error: `"${file.name}" is not an .xlsx file. Export the customer list first, then re-import that file.`,
    };
  }

  let parsed;
  try {
    parsed = await readCustomerWorkbook(await file.arrayBuffer());
  } catch (err) {
    return {
      ...EMPTY_IMPORT,
      error: err instanceof Error ? err.message : "That file could not be read.",
    };
  }

  if (!parsed.rows.length) {
    return {
      ...EMPTY_IMPORT,
      error: `No customer rows were found in "${file.name}". Download the template to see the expected columns.`,
    };
  }

  await db();

  const result: CustomerImportResult = {
    ok: true,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    warnings: [],
    mappingNote: parsed.mappingNote,
  };
  // One pass per DISTINCT name inside the file: a repeated name is reported,
  // not silently imported twice (the second row would otherwise overwrite the
  // first with no clue which one won).
  const seen = new Map<string, number>();

  for (const row of parsed.rows) {
    if (row.error || !row.input) {
      result.skipped += 1;
      result.errors.push(`Row ${row.rowNumber} (${row.label}): ${row.error}`);
      continue;
    }

    const input = row.input;
    const name = input.name.trim();
    const key = name.toLowerCase();

    const firstRow = seen.get(key);
    if (firstRow !== undefined) {
      result.skipped += 1;
      result.warnings.push(
        `Row ${row.rowNumber} (${name}): duplicate of row ${firstRow} — already imported, so this one was skipped.`
      );
      continue;
    }
    seen.set(key, row.rowNumber);

    // A blank cell (or a 0 in a term column) is SKIPPED, never written: on an
    // update the stored value stays untouched, on a create the schema default
    // applies. So re-importing an edited export can only fill things in — it
    // can never wipe a term, a group or a contact that the sheet left empty.
    // Only a real value (> 0 days / non-blank text) lands in the update.
    const $set: Record<string, unknown> = { name };
    if (input.address) $set.address = input.address;
    // Contact person and contact number are skipped independently: a row with
    // person = 0 but a real number saves the number and leaves the person alone.
    const person = contactValue(input.contactPerson);
    if (person) $set.contactPerson = person;
    const phone = contactValue(input.contactNumber);
    if (phone) $set.contactNumber = phone;
    if (input.category) $set.category = input.category;
    if (input.group.trim()) $set.group = input.group.trim();
    if (input.branch) $set.branch = input.branch;
    if (input.creditLimitDays !== null && input.creditLimitDays > 0) {
      $set.creditLimitDays = input.creditLimitDays;
    }
    if (input.termMinDays !== null && input.termMinDays > 0) {
      $set.termMinDays = input.termMinDays;
    }
    if (input.termMaxDays !== null && input.termMaxDays > 0) {
      $set.termMaxDays = input.termMaxDays;
    }

    try {
      const existing = await Customer.findOne({
        name: new RegExp(`^${escapeRegex(name)}$`, "i"),
      })
        .select({ _id: 1, name: 1 })
        .lean()
        .exec();

      if (existing) {
        await Customer.updateOne({ _id: existing._id }, { $set });

        // A rename must not orphan the pending-bill link: those rows carry a
        // `partyName` copy that is matched by name. Rewrite the copy so the two
        // can never disagree (same cascade as `updateCustomer`).
        if (name !== existing.name) {
          await PendingBill.updateMany(
            { customerId: existing._id },
            { $set: { partyName: name } }
          );
        }
        result.updated += 1;
      } else {
        await Customer.create({
          ...$set,
          createdBy: new Types.ObjectId(user.id),
          createdByRole: primaryRole(user.roles),
          approvalStatus: "pending",
        });
        result.created += 1;
      }
    } catch (err) {
      console.error("importCustomers", err);
      result.skipped += 1;
      result.errors.push(`Row ${row.rowNumber} (${name}): could not be saved.`);
    }
  }

  await logActivity({
    user,
    action: "import",
    module: "customers",
    detail: `Imported customers from Excel · ${result.created} created (pending approval) · ${result.updated} updated · ${result.skipped} skipped · by ${user.name} (${primaryRole(user.roles)})`,
  });

  revalidatePath("/", "layout");
  return result;
}
