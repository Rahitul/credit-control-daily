const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/creditcontroldaily";

const ADMIN_EMAIL = "rezaul.karim@iomltd.com";
const ADMIN_PASSWORD = process.env.SEED_PASSWORD || "admin@123";

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log("Connected to MongoDB");

  const userSchema = new mongoose.Schema({
    name: String,
    email: { type: String, unique: true },
    passwordHash: String,
    role: [
      {
        type: String,
        enum: ["esbd", "consumable", "sales", "eid", "eid_juniors", "accounts", "admin", "branches"],
      },
    ],
    department: String,
    status: { type: String, enum: ["active", "inactive"], default: "active" },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  });

  const User = mongoose.models.User || mongoose.model("User", userSchema);

  const existing = await User.findOne({ email: ADMIN_EMAIL });
  if (existing) {
    existing.passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    existing.role = ["admin"];
    existing.status = "active";
    await existing.save();
    console.log("Admin already existed — password/reset ensured:", ADMIN_EMAIL);
  } else {
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    const admin = await User.create({
      name: "Rezaul Karim",
      email: ADMIN_EMAIL,
      passwordHash,
      role: ["admin"],
      department: "Accounts",
      status: "active",
    });
    console.log("Admin user created:", admin.email);
  }

  console.log("Login → email:", ADMIN_EMAIL, "| password:", ADMIN_PASSWORD);
  await mongoose.connection.close();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
