/**
 * Extract every company name (Customer names + Pending Bill party names)
 * from MongoDB and save them under `scripts/`.
 *
 * Read-only: never writes to the database.
 *
 * Output (overwritten on each run):
 *   scripts/company-names.txt   one name per line (deduplicated, sorted)
 *   scripts/company-names.json  counts + per-source breakdown + full list
 *
 *   npm run export-companies
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = path.dirname(fileURLToPath(import.meta.url));

function loadEnvLocal() {
  const file = path.join(OUT_DIR, "..", ".env.local");
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvLocal();

const mongoose = (await import("mongoose")).default;
const { db } = await import("@/lib/db");
const { Customer } = await import("@/lib/models/Customer");
const { PendingBill } = await import("@/lib/models/PendingBill");

function normalize(name: string) {
  return name.replace(/\s+/g, " ").trim();
}

async function main() {
  await db();
  console.log("Connected to MongoDB");

  const customerNames = (await Customer.distinct("name", {})) as unknown as string[];
  const partyNames = (await PendingBill.distinct("partyName", {})) as unknown as string[];

  const fromCustomers = customerNames.map(normalize).filter(Boolean);
  const fromParties = partyNames.map(normalize).filter(Boolean);

  const map = new Map<string, string>(); // lowercased -> display name
  for (const n of [...fromCustomers, ...fromParties]) {
    const key = n.toLowerCase();
    if (!map.has(key)) map.set(key, n);
  }

  const names = [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, display]) => display);

  const generatedAt = new Date().toISOString();

  const txtPath = path.join(OUT_DIR, "company-names.txt");
  const jsonPath = path.join(OUT_DIR, "company-names.json");

  fs.writeFileSync(txtPath, names.join("\n") + (names.length ? "\n" : ""), "utf8");
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generatedAt,
        total: names.length,
        customerNames: new Set(fromCustomers.map((n) => n.toLowerCase())).size,
        partyNames: new Set(fromParties.map((n) => n.toLowerCase())).size,
        names,
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  console.log(`Customer names (distinct) : ${fromCustomers.length}`);
  console.log(`Party names (distinct)     : ${fromParties.length}`);``
  console.log(`Unique companies written   : ${names.length}`);
  console.log(`\nSaved:\n  ${txtPath}\n  ${jsonPath}`);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
