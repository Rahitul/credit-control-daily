"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { Dropdown, type DropdownType } from "@/lib/models/Dropdown";
import { DROPDOWN_TYPES } from "@/lib/types";
import { logActivity } from "@/lib/audit";
import { ENTRY_ROLES } from "@/lib/nav";
import type { ActionResult } from "@/lib/types";

const TYPES: DropdownType[] = [...DROPDOWN_TYPES];

function readType(formData: FormData): DropdownType | null {
  const raw = String(formData.get("type") ?? "").trim();
  return TYPES.includes(raw as DropdownType) ? (raw as DropdownType) : null;
}

export async function addDropdownOption(
  _prev: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await requireRole(...ENTRY_ROLES, "admin");

  const type = readType(formData);
  const value = String(formData.get("value") ?? "").trim();

  if (!type) {
    return { ok: false, error: "Select a valid dropdown type." };
  }
  if (!value) {
    return { ok: false, error: "Value is required." };
  }

  try {
    await db();
    const existing = await Dropdown.findOne({ type, value })
      .select({ _id: 1 })
      .lean()
      .exec();
    if (existing) {
      return { ok: false, error: `"${value}" already exists in ${type} list.` };
    }

    const doc = await Dropdown.create({ type, value });

    await logActivity({
      user,
      action: "create",
      module: "dropdowns",
      recordId: String(doc._id),
      detail: `Added ${type} option ${value}`,
    });

    revalidatePath("/", "layout");
    return { ok: true, id: String(doc._id) };
  } catch (err) {
    console.error("addDropdownOption", err);
    return { ok: false, error: "Failed to add option." };
  }
}

export async function deleteDropdownOption(
  _prev: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await requireRole(...ENTRY_ROLES, "admin");

  const id = String(formData.get("id") ?? "").trim();
  const type = readType(formData);
  const value = String(formData.get("value") ?? "").trim();

  if (!id || !type) {
    return { ok: false, error: "Missing option to delete." };
  }

  try {
    await db();
    const removed = await Dropdown.findByIdAndDelete(id).lean().exec();
    if (!removed) {
      return { ok: false, error: "Option not found." };
    }

    await logActivity({
      user,
      action: "delete",
      module: "dropdowns",
      recordId: id,
      detail: `Deleted ${type} option ${value || String(removed.value)}`,
    });

    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    console.error("deleteDropdownOption", err);
    return { ok: false, error: "Failed to delete option." };
  }
}
