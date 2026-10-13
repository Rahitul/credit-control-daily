/**
 * Set `creditLimitDays`, `termMinDays` and `termMaxDays` to 0 for EVERY
 * customer (the three term fields on the Customers list).
 *
 * Run:  npx tsx scripts/zero-customer-terms.mts
 *
 * MongoDB is unversioned and this write is irreversible in place, so before
 * updating the script prints AND saves the old values to a timestamped JSON
 * backup next to it — use that file to restore manually if needed.
 */
import mongoose from "mongoose";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const URI = process.env.MONGODB_URI ?? "mongodb://localhost:27017/creditcontroldaily";
const FIELDS = ["creditLimitDays", "termMinDays", "termMaxDays"] as const;

await mongoose.connect(URI);
const col = mongoose.connection.db!.collection("customers");

type Snapshot = { _id: unknown; name: string; creditLimitDays: unknown; termMinDays: unknown; termMaxDays: unknown };

const before = (await col
  .find({}, { projection: { name: 1, creditLimitDays: 1, termMinDays: 1, termMaxDays: 1 } })
  .toArray()) as unknown as Snapshot[];

console.log(`Customers found: ${before.length}`);
for (const c of before) {
  console.log(
    `  before  ${c.name}: creditLimitDays=${JSON.stringify(c.creditLimitDays)} ` +
      `termMinDays=${JSON.stringify(c.termMinDays)} termMaxDays=${JSON.stringify(c.termMaxDays)}`
  );
}

const backupFile = path.join(
  HERE,
  `customer-terms-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
);
fs.writeFileSync(backupFile, JSON.stringify(before, null, 2));
console.log(`Backup of old values written to: ${backupFile}`);

const res = await col.updateMany({}, { $set: { creditLimitDays: 0, termMinDays: 0, termMaxDays: 0 } });
console.log(`\nupdateMany: matched=${res.matchedCount} modified=${res.modifiedCount}`);

const after = (await col
  .find({}, { projection: { name: 1, creditLimitDays: 1, termMinDays: 1, termMaxDays: 1 } })
  .toArray()) as unknown as Snapshot[];

let ok = after.length > 0;
for (const c of after) {
  for (const f of FIELDS) {
    if (c[f] !== 0) {
      ok = false;
      console.error(`  MISMATCH  ${c.name}.${f} = ${JSON.stringify(c[f])}, expected 0`);
    }
  }
}
console.log(`Read-back: ${after.length} customer(s), all three fields = 0 → ${ok ? "PASS" : "FAIL"}`);

await mongoose.disconnect();
if (!ok) process.exit(1);
