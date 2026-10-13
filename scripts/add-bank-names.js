// Insert all banks of Bangladesh into the "bankName" dropdown (Manage Dropdowns > Bank Names).
// Insert-only and idempotent: existing values are never modified or deleted.
// Usage: node scripts/add-bank-names.js

const mongoose = require("mongoose");

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/creditcontroldaily";

// Official names (Bangladesh Bank scheduled banks + non-scheduled banks).
const BANK_NAMES = [
  // State-owned commercial banks
  "Agrani Bank PLC",
  "Bangladesh Development Bank PLC",
  "BASIC Bank PLC",
  "Janata Bank PLC",
  "Rupali Bank PLC",
  "Sammilito Islami Bank PLC",
  "Sonali Bank PLC",
  // Specialized banks
  "Bangladesh Krishi Bank",
  "Probashi Kollyan Bank",
  "Rajshahi Krishi Unnayan Bank",
  // Private commercial banks (conventional)
  "AB Bank PLC",
  "Bangladesh Commerce Bank Limited",
  "Bank Asia PLC",
  "Bengal Commercial Bank PLC",
  "BRAC Bank PLC",
  "Citizens Bank PLC",
  "City Bank PLC",
  "Community Bank Bangladesh PLC",
  "Dhaka Bank PLC",
  "Dutch-Bangla Bank PLC",
  "Eastern Bank PLC",
  "Export Import Bank of Bangladesh PLC",
  "IFIC Bank PLC",
  "Jamuna Bank PLC",
  "Meghna Bank PLC",
  "Mercantile Bank PLC",
  "Midland Bank Limited",
  "Modhumoti Bank PLC",
  "Mutual Trust Bank PLC",
  "National Bank PLC",
  "National Credit & Commerce Bank PLC",
  "NRB Bank PLC",
  "NRBC Bank PLC",
  "One Bank PLC",
  "Padma Bank PLC",
  "Prime Bank PLC",
  "Pubali Bank PLC",
  "SBAC Bank PLC",
  "Shimanto Bank PLC",
  "Southeast Bank PLC",
  "The Premier Bank PLC",
  "Trust Bank PLC",
  "Union Bank PLC",
  "United Commercial Bank PLC",
  "Uttara Bank PLC",
  // Private commercial banks (Islami Shariah based)
  "Al-Arafah Islami Bank PLC",
  "First Security Islami Bank PLC",
  "Global Islami Bank PLC",
  "ICB Islamic Bank Ltd.",
  "Islami Bank Bangladesh PLC",
  "Shahjalal Islami Bank PLC",
  "Social Islami Bank PLC",
  "Standard Islami Bank PLC",
  // Foreign commercial banks (branches in Bangladesh)
  "Bank Al-Falah Limited",
  "Citibank N.A.",
  "Commercial Bank of Ceylon Limited",
  "Habib Bank Ltd.",
  "National Bank of Pakistan",
  "Standard Chartered Bank",
  "State Bank of India",
  "The Hongkong and Shanghai Banking Corporation Ltd.",
  "Woori Bank",
  // Digital bank
  "Nagad Digital Bank PLC",
  // Non-scheduled banks
  "Ansar VDP Unnayan Bank",
  "Grameen Bank",
  "Jubilee Bank",
  "Karmashangosthan Bank",
  "Palli Sanchay Bank",
];

async function main() {
  await mongoose.connect(MONGODB_URI);

  const S = mongoose.Schema;
  const Dropdown =
    mongoose.models.Dropdown ||
    mongoose.model(
      "Dropdown",
      new S(
        {
          type: {
            type: String,
            enum: [
              "category",
              "branch",
              "billCategory",
              "paymentType",
              "bankType",
              "bankName",
            ],
            required: true,
          },
          value: { type: String, required: true, trim: true },
        },
        { timestamps: true }
      )
    );

  const existing = await Dropdown.find({ type: "bankName" })
    .select({ value: 1 })
    .lean()
    .exec();
  const present = new Set(existing.map((d) => String(d.value).trim().toLowerCase()));
  const before = existing.length;

  const seen = new Set();
  const toInsert = [];
  for (const name of BANK_NAMES) {
    const key = name.trim().toLowerCase();
    if (present.has(key) || seen.has(key)) continue;
    seen.add(key);
    toInsert.push({ type: "bankName", value: name.trim() });
  }

  if (toInsert.length) {
    await Dropdown.insertMany(toInsert, { ordered: false });
  }

  console.log(`bankName entries before: ${before}`);
  console.log(`inserted: ${toInsert.length}`);
  console.log(`already present (skipped): ${BANK_NAMES.length - toInsert.length}`);
  if (toInsert.length) {
    for (const d of toInsert) console.log(`  + ${d.value}`);
  }

  await mongoose.connection.close();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.connection.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
