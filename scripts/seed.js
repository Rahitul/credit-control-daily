const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/creditcontroldaily";

const ROLES = ["esbd", "consumable", "sales", "eid", "eid_juniors", "accounts", "admin", "branches"];
const DEPARTMENTS = ["Accounts", "Sales", "EID", "ESBD", "Consumable", "Branches"];

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log("Connected to MongoDB — seeding…");

  const S = mongoose.Schema;

  const User = mongoose.models.User || mongoose.model("User", new S({
    name: String,
    email: { type: String, unique: true },
    passwordHash: String,
    role: [{ type: String, enum: ROLES }],
    department: String,
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  }, { timestamps: true }));

  const Customer = mongoose.models.Customer || mongoose.model("Customer", new S({
    name: String,
    address: String,
    contactPerson: String,
    contactNumber: String,
    category: String,
    group: { type: String, default: "Not a Group of Company" },
    creditLimitDays: { type: Number, min: 0 },
    branch: String,
    createdBy: { type: S.Types.ObjectId, ref: "User" },
    createdByName: String,
    createdByRole: String,
    approvalStatus: { type: String, enum: ["pending", "approved"], default: "pending" },
    approvedBy: { type: S.Types.ObjectId, ref: "User" },
    approvedByName: String,
    approvedAt: Date,
  }, { timestamps: true }));

  const Sale = mongoose.models.Sale || mongoose.model("Sale", new S({
    referenceId: { type: String, unique: true },
    customerId: { type: S.Types.ObjectId, ref: "Customer" },
    saleDate: Date,
    description: String,
    amount: Number,
    billNo: { type: String, required: true },
    billDate: { type: Date, required: true },
    entryBy: String,
    createdBy: { type: S.Types.ObjectId, ref: "User" },
    createdByRole: String,
  }, { timestamps: true }));

  const Payment = mongoose.models.Payment || mongoose.model("Payment", new S({
    rcvDate: Date,
    customerId: { type: S.Types.ObjectId, ref: "Customer" },
    branch: String,
    billCategory: String,
    billNo: String,
    billDate: Date,
    paymentType: String,
    rcvAmount: Number,
    bankType: String,
    bankName: String,
    assignedPerson: String,
    entryBy: String,
    createdBy: { type: S.Types.ObjectId, ref: "User" },
    createdByRole: String,
    relatedSaleReferenceId: String,
    // Only `approved` payments count toward collected/outstanding/overdue. Seeded
    // demo payments are historical money that has already been released, so they
    // are created as `approved` — otherwise every seeded payment would silently
    // drop out of the totals and the overdue examples would stop working.
    approvalStatus: { type: String, enum: ["pending", "allocating", "approved"], default: "pending", index: true },
    approvedBy: { type: S.Types.ObjectId, ref: "User" },
    approvedByRole: String,
    approvedAt: Date,
    allocatedAmount: { type: Number, default: 0 },
    unallocatedAmount: { type: Number, default: 0 },
  }, { timestamps: true }));

  const Dropdown = mongoose.models.Dropdown || mongoose.model("Dropdown", new S({
    type: { type: String, enum: ["category", "branch", "billCategory", "paymentType", "bankType", "bankName"], required: true },
    value: { type: String, required: true, trim: true },
  }, { timestamps: true }));
  Dropdown.schema.index({ type: 1, value: 1 }, { unique: true });

  // --- Dropdown options ---
  const SEED_DROPDOWNS = {
    category: ["Retail", "Wholesale", "Corporate", "Government", "Distributor", "Other"],
    branch: ["Dhaka", "Chattogram", "Sylhet", "Khulna"],
    billCategory: ["Invoice", "Challan", "Delivery Note", "Credit Note", "Other"],
    paymentType: ["Cash", "Cheque", "bKash", "Nagad", "Bank Transfer", "Card"],
    bankType: ["City Bank", "BRAC Bank", "EBL", "DBBL", "IBBL", "Other"],
    bankName: ["Gulshan", "Dhanmondi", "Motijheel", "Agrabad", "Uttara"],
  };
  for (const [type, values] of Object.entries(SEED_DROPDOWNS)) {
    for (const value of values) {
      const existing = await Dropdown.findOne({ type, value });
      if (!existing) {
        await Dropdown.create({ type, value });
        console.log(`Seeded ${type}:`, value);
      }
    }
  }

  // --- Users (test accounts for each role) ---
  const testUsers = [
    { name: "Accounts User", email: "accounts@iomltd.com", role: ["accounts"], department: "Accounts" },
    { name: "Sales User", email: "sales@iomltd.com", role: ["sales"], department: "Sales" },
    { name: "EID User", email: "eid@iomltd.com", role: ["eid"], department: "EID" },
    { name: "ESBD User", email: "esbd@iomltd.com", role: ["esbd"], department: "ESBD" },
    { name: "Consumable User", email: "consumable@iomltd.com", role: ["consumable"], department: "Consumable" },
    { name: "Branches User", email: "branches@iomltd.com", role: ["branches"], department: "Branches" },
  ];
  const hash = await bcrypt.hash(process.env.SEED_PASSWORD || "admin@123", 10);
  for (const u of testUsers) {
    const existing = await User.findOne({ email: u.email });
    if (!existing) {
      await User.create({ ...u, passwordHash: hash, status: "active" });
      console.log("Created user:", u.email);
    } else {
      console.log("User exists:", u.email);
    }
  }
  // Seed customers reference the accounts user's ObjectId as the entering user
  const seedAccountsUser = await User.findOne({ email: "accounts@iomltd.com" }).lean();
  const seedCreatedBy = seedAccountsUser ? String(seedAccountsUser._id) : undefined;
  // Users by name, for entry tracking (createdBy / createdByRole) on seeded rows
  const seedUsers = await User.find().select({ name: 1, role: 1 }).lean();
  const userByName = new Map(seedUsers.map((u) => [u.name, u]));
  const firstRole = (u) =>
    u.role.includes("admin") ? "admin" : u.role.includes("accounts") ? "accounts" : u.role[0];

  // --- Customers / Sales / Payments (idempotent) ---
  // creditLimitDays = payment term: bill must be paid within N days.
  // Overdue = unpaid remaining balance on a sale past saleDate + creditLimitDays (FIFO).
  const DEMO_CUSTOMERS = [
    { key: "rahman", entryBy: "Accounts User", name: "Rahman Trading Co.", address: "12 Gulshan Ave, Dhaka", contactPerson: "Abdul Rahman", contactNumber: "+8801711000001", category: "Wholesale", group: "Not a Group of Company", creditLimitDays: 45, branch: "Dhaka" },
    { key: "global", entryBy: "Sales User", name: "Global Tech Ltd", address: "Plot 5, Agrabad, Chattogram", contactPerson: "Nusrat Jahan", contactNumber: "+8801711000002", category: "Corporate", group: "Not a Group of Company", creditLimitDays: 30, branch: "Chattogram" },
    { key: "sunrise", entryBy: "EID User", name: "Sunrise Enterprises", address: "Zindabazar, Sylhet", contactPerson: "Kamal Hossain", contactNumber: "+8801711000003", category: "Retail", group: "Not a Group of Company", creditLimitDays: 30, branch: "Sylhet" },
    { key: "metro", entryBy: "ESBD User", name: "Metro Supplies", address: "Mirpur 10, Dhaka", contactPerson: "Sadia Islam", contactNumber: "+8801711000004", category: "Distributor", group: "Not a Group of Company", creditLimitDays: 15, branch: "Dhaka" },
    { key: "delta", entryBy: "Consumable User", name: "Delta Industries", address: "Khulna Industrial Area", contactPerson: "Rafiqul Alam", contactNumber: "+8801711000005", category: "Corporate", group: "Not a Group of Company", creditLimitDays: 60, branch: "Khulna" },
    { key: "overlimit", entryBy: "Accounts User", name: "Overlimit Corp", address: "Motijheel, Dhaka", contactPerson: "Tanvir Ahmed", contactNumber: "+8801711000006", category: "Corporate", group: "Not a Group of Company", creditLimitDays: 7, branch: "Dhaka" },
    // Deliberate overdue demos
    { key: "latepay", entryBy: "Sales User", name: "Late Pay Traders", address: "Kawran Bazar, Dhaka", contactPerson: "Jashim Uddin", contactNumber: "+8801711000007", category: "Wholesale", group: "Not a Group of Company", creditLimitDays: 15, branch: "Dhaka" },
    { key: "almostdue", entryBy: "EID User", name: "Almost Due Ltd", address: "Agrabad, Chattogram", contactPerson: "Farhana Akter", contactNumber: "+8801711000008", category: "Corporate", group: "Not a Group of Company", creditLimitDays: 30, branch: "Chattogram" },
    { key: "clearing", entryBy: "ESBD User", name: "Clearing House BD", address: "Indira Road, Dhaka", contactPerson: "Mahbub Alam", contactNumber: "+8801711000009", category: "Distributor", group: "Not a Group of Company", creditLimitDays: 20, branch: "Dhaka" },
    // Within terms (not overdue)
    { key: "current", entryBy: "Consumable User", name: "Current Buyer Co.", address: "GEC Circle, Chattogram", contactPerson: "Sabbir Hossain", contactNumber: "+8801711000010", category: "Retail", group: "Not a Group of Company", creditLimitDays: 45, branch: "Chattogram" },
    { key: "paidup", entryBy: "Accounts User", name: "Paid Up Traders", address: "Zindabazar, Sylhet", contactPerson: "Rina Das", contactNumber: "+8801711000011", category: "Retail", group: "Not a Group of Company", creditLimitDays: 30, branch: "Sylhet" },
    // Volume rows entered by the other departments (entry-tracking + per-role list demos)
    { key: "meghna", entryBy: "Sales User", name: "Meghna Ceramics", address: "Agrabad C/A, Chattogram", contactPerson: "Shahnaz Parvin", contactNumber: "+8801711000012", category: "Retail", group: "Not a Group of Company", creditLimitDays: 30, branch: "Chattogram" },
    { key: "rafi", entryBy: "EID User", name: "Rafi Steel Ltd", address: "Sonadanga, Khulna", contactPerson: "Jahangir Alam", contactNumber: "+8801711000013", category: "Distributor", group: "Not a Group of Company", creditLimitDays: 45, branch: "Khulna" },
    // Pending approval queue (admin approves these; sale/payment forms reject them)
    { key: "nabil", entryBy: "Sales User", name: "Nabil Pharma", address: "Dhanmondi, Dhaka", contactPerson: "Nazmul Haque", contactNumber: "+8801711000014", category: "Corporate", group: "Not a Group of Company", creditLimitDays: 30, branch: "Dhaka", pending: true },
    { key: "tuli", entryBy: "ESBD User", name: "Tuli Agro", address: "Ambarkhana, Sylhet", contactPerson: "Rehana Begum", contactNumber: "+8801711000015", category: "Wholesale", group: "Not a Group of Company", creditLimitDays: 30, branch: "Sylhet", pending: true },
  ];

  const custByKey = {};
  for (const c of DEMO_CUSTOMERS) {
    const { key, entryBy, pending, ...fields } = c;
    const creator = userByName.get(entryBy);
    let doc = await Customer.findOne({ name: fields.name });
    if (!doc) {
      doc = await Customer.create({
        ...fields,
        createdBy: creator ? creator._id : seedCreatedBy,
        createdByRole: creator ? firstRole(creator) : "accounts",
        approvalStatus: pending ? "pending" : "approved",
        ...(pending
          ? {}
          : {
              approvedBy: seedCreatedBy,
              approvedByName: "System Seed",
              approvedAt: new Date(),
            }),
      });
      console.log(`Seeded customer: ${fields.name} (${pending ? "pending" : "approved"})`);
    } else if (!pending) {
      await Customer.updateOne(
        { _id: doc._id },
        {
          $set: {
            creditLimitDays: fields.creditLimitDays,
            category: fields.category,
            group: fields.group,
            branch: fields.branch,
            address: fields.address,
            contactPerson: fields.contactPerson,
            contactNumber: fields.contactNumber,
            approvalStatus: "approved",
          },
          $unset: { creditLimit: "", openingAmount: "", referenceNumber: "", department: "" },
        }
      );
    }
    custByKey[key] = doc;
  }

  // Backfill any legacy customers that predate the approval workflow
  {
    const res = await Customer.updateMany(
      { $or: [{ approvalStatus: { $exists: false } }, { approvalStatus: null }] },
      {
        $set: {
          approvalStatus: "approved",
          approvedByName: "Migration",
          approvedAt: new Date(),
        },
      }
    );
    if (res.modifiedCount > 0) {
      console.log(`Backfilled approvalStatus=approved for ${res.modifiedCount} legacy customer(s)`);
    }
  }

  // Drop leftover unique indexes on removed fields (blocks inserts when null)
  {
    const coll = mongoose.connection.collection("customers");
    const indexes = await coll.indexes();
    for (const legacy of ["referenceNumber_1", "creditLimit_1", "department_1", "openingAmount_1"]) {
      if (indexes.some((i) => i.name === legacy)) {
        await coll.dropIndex(legacy);
        console.log("Dropped legacy index:", legacy);
      }
    }
  }

  // helper: next free SALE-YYYY-NNNN
  async function nextRef() {
    const year = new Date().getFullYear();
    const prefix = `SALE-${year}-`;
    const last = await Sale.findOne({ referenceId: new RegExp(`^${prefix}`) })
      .sort({ referenceId: -1 })
      .select({ referenceId: 1 })
      .lean()
      .exec();
    let n = 1;
    if (last?.referenceId) {
      const parsed = parseInt(last.referenceId.slice(prefix.length), 10);
      if (!Number.isNaN(parsed)) n = parsed + 1;
    }
    return `${prefix}${String(n).padStart(4, "0")}`;
  }

  // sales: idempotent on billNo (mandatory + unique per demo row), so re-runs never duplicate.
  // Overdue examples use sale dates well past term with partial/no payment (FIFO).
  // entryBy is spread across departments so the role pill / dept filter are exercised.
  const DEMO_SALES = [
    // Rahman: 45-day term, old sales mostly paid → within / small balance
    { tag: "s-rahman-1", key: "rahman", saleDate: daysAgo(60), description: "Bulk order A", amount: 400000, billNo: "BILL-3001", billDate: daysAgo(59), entryBy: "Accounts User" },
    { tag: "s-rahman-2", key: "rahman", saleDate: daysAgo(20), description: "Restock", amount: 80000, billNo: "BILL-3002", billDate: daysAgo(19), entryBy: "Accounts User" },
    // Global: 30-day term, sale 40 days ago, partial → OVERDUE
    { tag: "s-global-1", key: "global", saleDate: daysAgo(40), description: "Server hardware", amount: 250000, billNo: "BILL-4100", billDate: daysAgo(41), entryBy: "Sales User" },
    // Sunrise: within terms
    { tag: "s-sunrise-1", key: "sunrise", saleDate: daysAgo(10), description: "Cables batch", amount: 120000, billNo: "BILL-5200", billDate: daysAgo(9), entryBy: "EID User" },
    // Metro: 15-day term, sale 25 days ago, partial → OVERDUE
    { tag: "s-metro-1", key: "metro", saleDate: daysAgo(25), description: "Office consumables", amount: 90000, billNo: "BILL-6300", billDate: daysAgo(25), entryBy: "ESBD User" },
    // Delta: 60-day term, within
    { tag: "s-delta-1", key: "delta", saleDate: daysAgo(20), description: "Machinery parts", amount: 160000, billNo: "BILL-7400", billDate: daysAgo(18), entryBy: "Consumable User" },
    // Overlimit: 7-day term, sale 15 days ago, partial → OVERDUE
    { tag: "s-overlimit-1", key: "overlimit", saleDate: daysAgo(15), description: "Emergency supply", amount: 120000, billNo: "BILL-8500", billDate: daysAgo(15), entryBy: "Accounts User" },
    // Late Pay: 15-day term, sale 45 days ago, small payment → heavily OVERDUE
    { tag: "s-latepay-1", key: "latepay", saleDate: daysAgo(45), description: "Wholesale rice lot", amount: 350000, billNo: "BILL-9600", billDate: daysAgo(44), entryBy: "Sales User" },
    { tag: "s-latepay-2", key: "latepay", saleDate: daysAgo(30), description: "Oil drums", amount: 120000, billNo: "BILL-9601", billDate: daysAgo(28), entryBy: "Sales User" },
    // Almost Due: 30-day term, sale 35 days ago, half paid → OVERDUE
    { tag: "s-almostdue-1", key: "almostdue", saleDate: daysAgo(35), description: "Network gear", amount: 200000, billNo: "BILL-9602", billDate: daysAgo(35), entryBy: "EID User" },
    // Clearing: 20-day term, sale 35 days ago, almost paid → small OVERDUE
    { tag: "s-clearing-1", key: "clearing", saleDate: daysAgo(35), description: "Packaging materials", amount: 100000, billNo: "BILL-9603", billDate: daysAgo(33), entryBy: "ESBD User" },
    // Current Buyer: 45-day term, sale 10 days ago, unpaid → within
    { tag: "s-current-1", key: "current", saleDate: daysAgo(10), description: "Retail restock", amount: 75000, billNo: "BILL-9604", billDate: daysAgo(10), entryBy: "Consumable User" },
    // Paid Up: fully paid → within / zero outstanding
    { tag: "s-paidup-1", key: "paidup", saleDate: daysAgo(40), description: "Seasonal order", amount: 95000, billNo: "BILL-9605", billDate: daysAgo(38), entryBy: "Accounts User" },
    // Recent volume, one per department (all within terms)
    { tag: "s-meghna-1", key: "meghna", saleDate: daysAgo(8), description: "Floor tile order", amount: 145000, billNo: "BILL-9700", billDate: daysAgo(8), entryBy: "Sales User" },
    { tag: "s-rafi-1", key: "rafi", saleDate: daysAgo(5), description: "TMT bar supply", amount: 260000, billNo: "BILL-9701", billDate: daysAgo(5), entryBy: "EID User" },
    { tag: "s-sunrise-2", key: "sunrise", saleDate: daysAgo(4), description: "Patch panel batch", amount: 65000, billNo: "BILL-9702", billDate: daysAgo(4), entryBy: "Consumable User" },
    { tag: "s-metro-2", key: "metro", saleDate: daysAgo(3), description: "Printer toner refill", amount: 55000, billNo: "BILL-9703", billDate: daysAgo(3), entryBy: "ESBD User" },
    { tag: "s-global-2", key: "global", saleDate: daysAgo(2), description: "Storage expansion", amount: 180000, billNo: "BILL-9704", billDate: daysAgo(2), entryBy: "Accounts User" },
  ];

  const saleByTag = {};
  const saleBillByTag = {};
  let createdSales = 0;
  for (const s of DEMO_SALES) {
    const existing = await Sale.findOne({ billNo: s.billNo })
      .select({ _id: 1, referenceId: 1, billNo: 1, billDate: 1 })
      .lean()
      .exec();
    if (existing) {
      saleByTag[s.tag] = existing.referenceId;
      saleBillByTag[s.tag] = { billNo: existing.billNo, billDate: existing.billDate };
      continue;
    }
    const referenceId = await nextRef();
    const created = await Sale.create({
      referenceId,
      customerId: custByKey[s.key]._id,
      saleDate: s.saleDate,
      description: s.description,
      amount: s.amount,
      billNo: s.billNo,
      billDate: s.billDate,
      entryBy: s.entryBy,
      createdBy: userByName.get(s.entryBy)?._id ?? seedCreatedBy,
      createdByRole: firstRole(userByName.get(s.entryBy)),
    });
    saleByTag[s.tag] = referenceId;
    saleBillByTag[s.tag] = { billNo: created.billNo, billDate: created.billDate };
    createdSales += 1;
  }
  console.log("Seeded/ensured sales:", createdSales);

  // Backfill sales created before billNo/billDate became mandatory
  {
    const legacy = await Sale.find({
      $or: [{ billNo: { $exists: false } }, { billNo: null }, { billDate: { $exists: false } }, { billDate: null }],
    })
      .select({ _id: 1, referenceId: 1, saleDate: 1 })
      .lean();
    let n = 0;
    for (const doc of legacy) {
      await Sale.updateOne(
        { _id: doc._id },
        {
          $set: {
            billNo: `MIG-${(doc.referenceId || String(doc._id)).replace(/[^A-Za-z0-9-]/g, "")}`,
            billDate: doc.saleDate ?? new Date(),
          },
        }
      );
      n += 1;
    }
    if (n > 0) console.log("Backfilled billNo/billDate for", n, "legacy sale(s)");
  }

  // Backfill entry tracking on sales that predate createdBy/createdByRole:
  // resolve the matching User by the `entryBy` name snapshot, then snapshot their role.
  {
    const legacy = await Sale.find({
      $or: [{ createdBy: { $exists: false } }, { createdBy: null }, { createdByRole: { $exists: false } }, { createdByRole: null }],
    })
      .select({ _id: 1, entryBy: 1 })
      .lean();
    let n = 0;
    for (const doc of legacy) {
      const u = doc.entryBy ? userByName.get(doc.entryBy) : undefined;
      await Sale.updateOne(
        { _id: doc._id },
        {
          $set: {
            createdBy: u ? u._id : null,
            createdByRole: u ? firstRole(u) : null,
          },
        }
      );
      n += 1;
    }
    if (n > 0) console.log("Backfilled createdBy/createdByRole for", n, "legacy sale(s)");
  }

  // FIFO implication (oldest first) for overdue demos:
  // Late Pay: paid 150k → clears latepay-1 partially (350k→200k overdue) + need more?
  // Actually FIFO across customer only: payments only to that customer.
  // Late Pay pays 150k against 350k first sale → 200k left on overdue sale 1 + full 120k on sale 2 overdue.
  const DEMO_PAYMENTS = [
    // Rahman: 350k paid against 400k old sale → first sale still 50k past 45 days? sale 60d ago + 45 term = due 15d ago → 50k OVERDUE; sale2 within
    { tag: "p-rahman-1", key: "rahman", rcvDate: daysAgo(50), amount: 200000, paymentType: "Bank Transfer", bankType: "City Bank", bankName: "Gulshan", branch: "Dhaka", billCategory: "Invoice", billNo: "INV-1001", entryBy: "Sales User", assignedPerson: "Sales User", relatedTag: "s-rahman-1" },
    { tag: "p-rahman-2", key: "rahman", rcvDate: daysAgo(18), amount: 150000, paymentType: "bKash", branch: "Dhaka", billCategory: "Invoice", billNo: "INV-1002", entryBy: "Sales User", assignedPerson: "Sales User", relatedTag: "s-rahman-2" },
    // Global: 100k of 250k, sale 40d ago / 30 term → due 10d ago → 150k OVERDUE
    { tag: "p-global-1", key: "global", rcvDate: daysAgo(14), amount: 100000, paymentType: "Cheque", bankType: "BRAC Bank", bankName: "Agrabad", branch: "Chattogram", billCategory: "Invoice", billNo: "INV-1003", entryBy: "EID User", assignedPerson: "EID User", relatedTag: "s-global-1" },
    // Sunrise: fully paid → within
    { tag: "p-sunrise-1", key: "sunrise", rcvDate: daysAgo(5), amount: 120000, paymentType: "Cash", branch: "Sylhet", entryBy: "ESBD User", assignedPerson: "ESBD User", relatedTag: "s-sunrise-1" },
    // Metro: 60k of 90k, 25d ago / 15 term → due 10d ago → 30k OVERDUE
    { tag: "p-metro-1", key: "metro", rcvDate: daysAgo(8), amount: 60000, paymentType: "Cash", branch: "Dhaka", entryBy: "Consumable User", assignedPerson: "Consumable User", relatedTag: "s-metro-1" },
    // Delta: partial but within term (sale 20d + 60 term)
    { tag: "p-delta-1", key: "delta", rcvDate: daysAgo(4), amount: 50000, paymentType: "Bank Transfer", bankType: "EBL", bankName: "Motijheel", branch: "Khulna", entryBy: "Accounts User", assignedPerson: "Sales User", relatedTag: "s-delta-1" },
    // Overlimit: 30k of 120k, 15d ago / 7 term → 90k OVERDUE
    { tag: "p-overlimit-1", key: "overlimit", rcvDate: daysAgo(10), amount: 30000, paymentType: "Cash", branch: "Dhaka", entryBy: "EID User", assignedPerson: "EID User", relatedTag: "s-overlimit-1" },
    // Late Pay: 150k FIFO → 200k left on sale1 + 120k sale2 = 320k OVERDUE
    { tag: "p-latepay-1", key: "latepay", rcvDate: daysAgo(20), amount: 150000, paymentType: "Cheque", bankType: "City Bank", bankName: "Motijheel", branch: "Dhaka", billCategory: "Invoice", billNo: "INV-2001", entryBy: "Accounts User", assignedPerson: "Accounts User", relatedTag: "s-latepay-1" },
    // Almost Due: 80k of 200k → 120k OVERDUE
    { tag: "p-almostdue-1", key: "almostdue", rcvDate: daysAgo(12), amount: 80000, paymentType: "Bank Transfer", bankType: "DBBL", bankName: "Agrabad", branch: "Chattogram", entryBy: "Accounts User", assignedPerson: "EID User", relatedTag: "s-almostdue-1" },
    // Clearing: 95k of 100k → 5k OVERDUE
    { tag: "p-clearing-1", key: "clearing", rcvDate: daysAgo(10), amount: 95000, paymentType: "Nagad", branch: "Dhaka", entryBy: "Sales User", assignedPerson: "Sales User", relatedTag: "s-clearing-1" },
    // Current: no payment needed for within-terms outstanding
    // Paid Up: fully paid
    { tag: "p-paidup-1", key: "paidup", rcvDate: daysAgo(15), amount: 95000, paymentType: "Cash", branch: "Sylhet", entryBy: "ESBD User", assignedPerson: "ESBD User", relatedTag: "s-paidup-1" },
    // Recent volume, spread across departments
    { tag: "p-meghna-1", key: "meghna", rcvDate: daysAgo(3), amount: 50000, paymentType: "Bank Transfer", bankType: "EBL", bankName: "Agrabad", branch: "Chattogram", entryBy: "Sales User", assignedPerson: "Sales User", relatedTag: "s-meghna-1" },
    { tag: "p-rafi-1", key: "rafi", rcvDate: daysAgo(2), amount: 100000, paymentType: "Cheque", bankType: "BRAC Bank", bankName: "Uttara", branch: "Khulna", entryBy: "EID User", assignedPerson: "EID User", relatedTag: "s-rafi-1" },
    { tag: "p-sunrise-2", key: "sunrise", rcvDate: daysAgo(1), amount: 65000, paymentType: "Cash", branch: "Sylhet", entryBy: "Consumable User", assignedPerson: "Consumable User", relatedTag: "s-sunrise-2" },
    { tag: "p-metro-2", key: "metro", rcvDate: daysAgo(1), amount: 20000, paymentType: "Card", branch: "Dhaka", entryBy: "ESBD User", assignedPerson: "ESBD User", relatedTag: "s-metro-2" },
    { tag: "p-rahman-3", key: "rahman", rcvDate: daysAgo(6), amount: 40000, paymentType: "Nagad", branch: "Dhaka", entryBy: "Accounts User", assignedPerson: "Accounts User", relatedTag: "s-rahman-2" },
  ];

  let createdPayments = 0;
  for (const p of DEMO_PAYMENTS) {
    // Bill data mirrors what the payment form auto-fills from the linked sale
    const saleBill = p.relatedTag ? saleBillByTag[p.relatedTag] : undefined;
    const billNo = p.billNo ?? saleBill?.billNo;
    const billDate = p.billNo
      ? daysAgo(Math.floor((Date.now() - p.rcvDate.getTime()) / 86400000) + 1)
      : saleBill?.billDate;

    // Idempotency: customer + amount + type on the same calendar day. An exact
    // rcvDate (or billNo alone) never matches on a re-run — daysAgo() carries the
    // run's clock time, and two payments may legitimately share a sale's bill number.
    const dayStart = new Date(p.rcvDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(p.rcvDate);
    dayEnd.setHours(23, 59, 59, 999);
    const stable = await Payment.findOne({
      customerId: custByKey[p.key]._id,
      rcvAmount: p.amount,
      paymentType: p.paymentType,
      rcvDate: { $gte: dayStart, $lte: dayEnd },
    })
      .select({ _id: 1 })
      .lean();
    if (stable) continue;

    const creator = userByName.get(p.entryBy);
    await Payment.create({
      rcvDate: p.rcvDate,
      customerId: custByKey[p.key]._id,
      branch: p.branch,
      billCategory: p.billCategory,
      billNo,
      billDate,
      paymentType: p.paymentType,
      rcvAmount: p.amount,
      bankType: p.bankType,
      bankName: p.bankName,
      assignedPerson: p.assignedPerson,
      entryBy: p.entryBy,
      createdBy: creator ? creator._id : seedCreatedBy,
      createdByRole: creator ? firstRole(creator) : "accounts",
      relatedSaleReferenceId: p.relatedTag ? saleByTag[p.relatedTag] : undefined,
      // Historical demo money: already released, so it must count in the totals.
      approvalStatus: "approved",
      approvedAt: p.rcvDate,
      allocatedAmount: p.amount,
      unallocatedAmount: 0,
    });
    createdPayments += 1;
  }
  console.log("Seeded/ensured payments:", createdPayments);

  // Backfill entry tracking on payments that predate createdBy/createdByRole
  {
    const legacy = await Payment.find({
      $or: [{ createdBy: { $exists: false } }, { createdBy: null }, { createdByRole: { $exists: false } }, { createdByRole: null }],
    })
      .select({ _id: 1, entryBy: 1 })
      .lean();
    let n = 0;
    for (const doc of legacy) {
      const u = doc.entryBy ? userByName.get(doc.entryBy) : undefined;
      await Payment.updateOne(
        { _id: doc._id },
        { $set: { createdBy: u ? u._id : null, createdByRole: u ? firstRole(u) : null } }
      );
      n += 1;
    }
    if (n > 0) console.log("Backfilled createdBy/createdByRole for", n, "legacy payment(s)");
  }

  // Backfill the payment approval workflow on rows that predate it.
  //
  // Existing payments are marked `approved` on purpose: they were already being
  // counted toward collected/outstanding/overdue before this field existed, so
  // defaulting them to `pending` would make every one of them disappear from the
  // figures and leave customers looking suddenly ৳-owed. Only payments entered from
  // now on start life as `pending`.
  {
    const res = await Payment.updateMany(
      { $or: [{ approvalStatus: { $exists: false } }, { approvalStatus: null }] },
      { $set: { approvalStatus: "approved" } }
    );
    if (res.modifiedCount > 0) {
      console.log("Backfilled approvalStatus=approved for", res.modifiedCount, "pre-existing payment(s)");
    }
  }

  const totalCustomers = await Customer.countDocuments();
  const totalSales = await Sale.countDocuments();
  const totalPayments = await Payment.countDocuments();
  console.log(
    `DB totals — customers: ${totalCustomers}, sales: ${totalSales}, payments: ${totalPayments}`
  );
  const [salesByRole, paymentsByRole, customersByApproval] = await Promise.all([
    Sale.aggregate([{ $group: { _id: "$createdByRole", n: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    Payment.aggregate([{ $group: { _id: "$createdByRole", n: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    Customer.aggregate([{ $group: { _id: "$approvalStatus", n: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
  ]);
  const fmt = (rows) => rows.map((r) => `${r._id || "none"}=${r.n}`).join(", ");
  console.log(`Sales by entering role — ${fmt(salesByRole)}`);
  console.log(`Payments by entering role — ${fmt(paymentsByRole)}`);
  console.log(`Customers by approval — ${fmt(customersByApproval)}`);
  console.log(
    "Overdue demos: Late Pay Traders, Almost Due Ltd, Metro Supplies, Global Tech Ltd, Overlimit Corp, Clearing House BD, Rahman Trading Co. (partial)"
  );
  console.log("Pending approval demos: Nabil Pharma, Tuli Agro (approve as admin)");

  console.log("Seed complete.");
  console.log(`Test logins (password: ${process.env.SEED_PASSWORD || "admin@123"}):`);
  console.log("  admin → rezaul.karim@iomltd.com");
  for (const u of testUsers) console.log(`  ${u.role[0]} → ${u.email}`);
  await mongoose.connection.close();
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

main().catch((err) => {
  console.error("Seed error:", err);
  process.exit(1);
});
