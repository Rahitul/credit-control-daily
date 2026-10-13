"use server";

import { revalidatePath } from "next/cache";
import { Types } from "mongoose";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { Sale } from "@/lib/models/Sale";
import { logActivity } from "@/lib/audit";
import { ENTRY_ROLES, assigneeForNewRow, primaryRole } from "@/lib/nav";
import { routeReference, parseReferenceNo } from "@/lib/pendingBills";
import { getBranchRoutes } from "@/lib/branchesData";
import { ensureCustomerForParty } from "@/lib/partyCustomers";
import { resolveDepartmentsFromMapping } from "@/lib/pendingBillsData";

export type SaleImportResult = {
  ok: boolean;
  error?: string;
  created: number;
  updated: number;
  skipped: number;
  customersCreated: number;
  errors: string[];
  warnings: string[];
  routing: Record<string, number>;
  mappingNote?: string;
};

const EMPTY: SaleImportResult = {
  ok: true,
  created: 0,
  updated: 0,
  skipped: 0,
  customersCreated: 0,
  errors: [],
  warnings: [],
  routing: {},
};

export async function importSales(
  _prev: SaleImportResult | undefined,
  formData: FormData
): Promise<SaleImportResult> {
  const user = await requireRole(...ENTRY_ROLES);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ...EMPTY, error: "Choose an .xlsx file to import." };
  }
  if (!/\.xlsx$/i.test(file.name)) {
    return {
      ...EMPTY,
      error: `"${file.name}" is not an .xlsx file. Export the register first, then re-import that file.`,
    };
  }

  let parsed;
  try {
    const { readSaleWorkbook } = await import("@/lib/saleImport");
    parsed = await readSaleWorkbook(await file.arrayBuffer());
  } catch (err) {
    return {
      ...EMPTY,
      error: err instanceof Error ? err.message : "That file could not be read.",
    };
  }

  if (!parsed.rows.length) {
    return {
      ...EMPTY,
      error: `No sale rows were found in "${file.name}". Download the template to see the expected columns.`,
    };
  }

  await db();

  const result: SaleImportResult = {
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
  const landed: { referenceId: string; departments: string[] }[] = [];
  const partyCustomer = new Map<string, string>();
  // Routing runs once per row, so the branch list is fetched exactly once for the
  // whole file rather than per sale.
  const branchRoutes = await getBranchRoutes();

  for (const row of parsed.rows) {
    if (row.error || !row.input) {
      result.skipped += 1;
      result.errors.push(`Row ${row.rowNumber} (${row.label}): ${row.error}`);
      continue;
    }

    const input = row.input;
    const parsedRef = parseReferenceNo(input.referenceId);
    const billNo = parsedRef.billNumber ?? input.referenceId;
    const billDate = parsedRef.embeddedDate ? toDateInput(parsedRef.embeddedDate) : input.saleDate;

    // Resolve departments using mapping database (with auto-fallback) for import
    // For sales, the bill number is in the `billNo` field
    const resolved = await resolveDepartmentsFromMapping(billNo, branchRoutes, user.id);
    const departments = resolved.departments;

    // Get branch info from routeReference (branch routing is separate from department mapping)
    const routed = routeReference(input.referenceId, branchRoutes);
    const branch = routed.branchId
      ? { branchId: new Types.ObjectId(routed.branchId), branchName: routed.branchName }
      : null;

    const existing = await Sale.findOne({ referenceId: input.referenceId })
      .select({ _id: 1 })
      .lean()
      .exec();

    // Ensure the customer exists — create it if not found
    const partyKey = input.partyName.trim().toLowerCase();
    if (!partyCustomer.has(partyKey)) {
      try {
        const ensured = await ensureCustomerForParty(input.partyName, user);
        if (ensured.created) result.customersCreated += 1;
        partyCustomer.set(partyKey, ensured.id);
      } catch (err) {
        console.error("ensureCustomerForParty", err);
        result.warnings.push(
          `Row ${row.rowNumber} (${row.label}): the sale was imported but a customer could not be created for this party.`
        );
        partyCustomer.set(partyKey, "");
      }
    }
    const customerId = partyCustomer.get(partyKey) || "";

    if (!customerId) {
      result.skipped += 1;
      result.errors.push(
        `Row ${row.rowNumber} (${row.label}): customer "${input.partyName}" could not be created.`
      );
      continue;
    }

    const $set = {
      referenceId: input.referenceId,
      customerId: new Types.ObjectId(customerId),
      saleDate: new Date(input.saleDate),
      amount: input.amount,
      billNo,
      billDate: new Date(billDate),
      departments,
      ...(branch ?? {}),
      entryBy: user.name,
      createdBy: new Types.ObjectId(user.id),
      createdByRole: primaryRole(user.roles),
    };

    if (existing) {
      // `$set` must NOT carry `assignedTo`: re-importing a file that has already
      // been distributed must not drag every row back to the importer. A row that
      // no longer matches any branch prefix has its branch link cleared.
      await Sale.updateOne(
        { _id: existing._id },
        { $set, $unset: branch ? {} : { branchId: 1, branchName: 1 } }
      );
      result.updated += 1;
    } else {
      await Sale.create({
        ...$set,
        // Insert only — a sales user's own sales-routed rows are theirs from the
        // moment they are created.
        ...(assigneeForNewRow(user.roles, user.id, departments)
          ? { assignedTo: new Types.ObjectId(user.id) }
          : {}),
      });
      result.created += 1;
    }

    landed.push({ referenceId: input.referenceId, departments });
    for (const w of row.warnings) {
      result.warnings.push(`Row ${row.rowNumber} (${row.label}): ${w}`);
    }
  }

  result.routing = summariseRouting(landed);

  await logActivity({
    user,
    action: "import",
    module: "sales",
    detail: `Imported "${file.name}" · ${result.created} created, ${result.updated} updated, ${result.skipped} skipped · ${Object.entries(result.routing)
      .map(([k, v]) => `${v} → ${k}`)
      .join(", ")}`,
  });

  revalidatePath("/", "layout");
  return result;
}

function toDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function summariseRouting(
  inputs: readonly { referenceId: string; departments: string[] }[]
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { departments } of inputs) {
    const key = departments.length ? departments.join(" + ") : "Accounts only";
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}
