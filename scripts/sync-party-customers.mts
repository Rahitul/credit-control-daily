/**
 * Make sure every party in the Pending Bills register has a matching Customer.
 *
 * Entering a bill (form or Excel import) already creates the customer going
 * forward — this exists to backfill parties that were entered BEFORE that
 * behaviour existed, and to repair the register at any time.
 *
 * Idempotent and non-destructive: it only ever ADDS a customer for a name that
 * has none, and never edits or deletes an existing customer.
 *
 *   npm run sync-parties
 */

import mongoose from "mongoose";
import { syncPartiesToCustomers } from "@/lib/partyCustomers";

const { db } = await import("@/lib/db");
const { Customer } = await import("@/lib/models/Customer");
const { PendingBill } = await import("@/lib/models/PendingBill");
const { User } = await import("@/lib/models/User");

async function main() {
  await db();
  console.log("Connected to MongoDB");

  // Attribute the created customers to a real user so the customer list's
  // "Entered By" column resolves. Prefer the admin, else the first active user.
  const admin = await User.findOne({ role: "admin" }).select({ _id: 1, name: 1, role: 1 }).lean().exec();
  const fallback = await User.findOne({}).select({ _id: 1, name: 1, role: 1 }).lean().exec();
  const actorUser = admin ?? fallback;

  if (!actorUser) {
    console.error("No users found. Run `npm run add-admin` first.");
    process.exit(1);
  }

  const roles = (actorUser.role as string[]) ?? ["accounts"];
  console.log(`Attributing new customers to ${actorUser.name} (${roles.join(", ")})\n`);

  const before = await Customer.countDocuments({});
  const result = await syncPartiesToCustomers({
    id: String(actorUser._id),
    name: actorUser.name ?? "System",
    roles: roles as never,
  });
  const after = await Customer.countDocuments({});

  console.log(`Distinct parties in the register : ${result.total}`);
  console.log(`Customers before                 : ${before}`);
  console.log(`Customers created                : ${result.created.length}`);
  console.log(`Customers already matched        : ${result.existing.length}`);
  console.log(`Customers after                  : ${after}`);
  console.log(`\nBills scanned                   : ${result.link.billsScanned}`);
  console.log(`Bills linked to a customer      : ${result.link.linked}`);

  if (result.created.length) {
    console.log("\nNew customers:");
    for (const n of result.created) console.log(`  + ${n}`);
  }

  const bills = await PendingBill.countDocuments({});
  console.log(`\nPending bills in the register: ${bills}`);
  console.log(
    "\nDone. These parties now appear in the customer list, in Add Payment, and every bill carries customerId."
  );

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
