/**
 * SERVER-ONLY: keep a `Customer` record in step with the Pending Bills register.
 *
 * A pending bill's `partyName` is free text and is NOT linked to `Customer`, so
 * the two registers used to be entirely disjoint — 55 parties, 0 of which
 * matched a customer. That made a party unpayable: `Payment.customerId` is a
 * required `ref: "Customer"`, `createPayment` rejects anything that is not an
 * approved customer, and every outstanding/overdue figure is keyed on that id.
 *
 * So entering a pending bill — by form or by Excel import — now also ENSURES a
 * customer of that name exists. The party then appears in the customer list and
 * can be selected in Add Payment, with no change to any of the money logic.
 *
 * Idempotent: matching is a case-insensitive whole-name lookup, so importing the
 * same file twice reuses the customer instead of forking a second one.
 */

import { Types } from "mongoose";
import { db } from "@/lib/db";
import { Customer } from "@/lib/models/Customer";
import { PendingBill } from "@/lib/models/PendingBill";
import { primaryRole } from "@/lib/nav";
import { DEFAULT_CUSTOMER_GROUP, type Role } from "@/lib/types";

/** Payment term in days given to an auto-created party customer. They usually
 *  have no sales yet, so this only matters once a sale is raised against them. */
export const PARTY_CUSTOMER_TERM_DAYS = 30;

/**
 * Auto-created party customers are approved immediately, because the point of
 * creating them is to be able to pay them: `PaymentNewView` only lists approved
 * customers and `createPayment` rejects the rest. That does mean entering a
 * pending bill bypasses the admin approval workflow that `createCustomer` uses,
 * so this is deliberately one constant — flip it to "pending" to route these
 * through admin approval instead.
 */
const PARTY_CUSTOMER_APPROVAL: "approved" | "pending" = "approved";

/** Whoever caused the party to exist: the user who entered the bill. */
export type PartyActor = { id: string; name: string; roles: Role[] };

function escapeRegex(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A bad session id must not throw and take the whole bill save down with it. */
function maybeObjectId(id: string): Types.ObjectId | undefined {
  return Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : undefined;
}

/** Find an existing customer by whole name, case- and whitespace-insensitive. */
export async function findCustomerByName(name: string) {
  const clean = name.trim();
  if (!clean) return null;
  return Customer.findOne({ name: new RegExp(`^${escapeRegex(clean)}$`, "i") })
    .select({ _id: 1 })
    .lean()
    .exec();
}

/**
 * Ensure a customer exists for `partyName`, creating it if not.
 * `termDays` overrides the payment term written on a NEW customer (the Excel
 * import passes 0 so imported parties start with no term); existing customers
 * are never touched. Returns the customer id and whether this call created it.
 */
export async function ensureCustomerForParty(
  partyName: string,
  actor: PartyActor,
  termDays: number = PARTY_CUSTOMER_TERM_DAYS
): Promise<{ id: string; created: boolean }> {
  const name = partyName.trim();
  if (!name) return { id: "", created: false };

  await db();

  const existing = await findCustomerByName(name);
  if (existing) return { id: String(existing._id), created: false };

  const doc = await Customer.create({
    name,
    group: DEFAULT_CUSTOMER_GROUP,
    creditLimitDays: termDays,
    approvalStatus: PARTY_CUSTOMER_APPROVAL,
    createdBy: maybeObjectId(actor.id),
    createdByRole: primaryRole(actor.roles),
    ...(PARTY_CUSTOMER_APPROVAL === "approved"
      ? {
          approvedBy: maybeObjectId(actor.id),
          approvedByName: actor.name,
          approvedAt: new Date(),
        }
      : {}),
  });

  return { id: String(doc._id), created: true };
}

/**
 * Resolve the customer for a party without caring whether it was just created.
 * Returns `undefined` only when the party name is blank, so a caller can store
 * it straight into `PendingBill.customerId`.
 */
export async function resolvePartyCustomer(
  partyName: string,
  actor: PartyActor
): Promise<string | undefined> {
  const result = await ensureCustomerForParty(partyName, actor);
  return result.id || undefined;
}

/**
 * Backfill `PendingBill.customerId` for every bill that has no link (or whose
 * party no longer matches the linked customer). Walks distinct parties first so
 * a register with 500 bills from 40 parties does 40 lookups, not 500.
 */
export async function linkBillsToCustomers(actor: PartyActor) {
  await db();

  const bills = await PendingBill.find({}).select({ partyName: 1, customerId: 1 }).lean().exec();

  const byParty = new Map<string, string | undefined>();
  for (const bill of bills) {
    const key = (bill.partyName ?? "").trim().toLowerCase();
    if (!key || byParty.has(key)) continue;
    byParty.set(key, await resolvePartyCustomer(bill.partyName, actor));
  }

  let linked = 0;
  const ops: { updateOne: { filter: Record<string, unknown>; update: Record<string, unknown> } }[] = [];

  for (const bill of bills) {
    const key = (bill.partyName ?? "").trim().toLowerCase();
    const customerId = byParty.get(key);
    if (!customerId) continue;
    if (String(bill.customerId ?? "") === customerId) continue;
    ops.push({
      updateOne: { filter: { _id: bill._id }, update: { $set: { customerId } } },
    });
    linked += 1;
  }

  if (ops.length) await PendingBill.bulkWrite(ops, { ordered: false });

  return { billsScanned: bills.length, distinctParties: byParty.size, linked };
}

/**
 * Backfill/repair helper: make sure every distinct party in the register has a
 * customer AND every bill points at it. Used by `npm run sync-parties`, and safe
 * to re-run at any time.
 */
export async function syncPartiesToCustomers(actor: PartyActor) {
  await db();

  const parties = await pendingBillPartyNames();
  const seen = new Set<string>();
  const created: string[] = [];
  const existing: string[] = [];

  for (const name of parties) {
    const key = name.trim().toLowerCase();
    if (!key || seen.has(key)) continue; // collapse "Acme" / "ACME " in one pass
    seen.add(key);

    const result = await ensureCustomerForParty(name, actor);
    if (!result.id) continue;
    (result.created ? created : existing).push(name);
  }

  const link = await linkBillsToCustomers(actor);

  return { total: seen.size, created, existing, link };
}

/** Distinct, trimmed party names currently in the register. */
async function pendingBillPartyNames(): Promise<string[]> {
  const rows = await PendingBill.find({})
    .select({ partyName: 1 })
    .lean()
    .exec();
  return rows
    .map((r) => (r.partyName ?? "").trim())
    .filter(Boolean)
    .sort();
}
