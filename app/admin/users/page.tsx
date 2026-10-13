import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { User } from "@/lib/models/User";
import { Branch } from "@/lib/models/Branch";
import { PageHeader } from "@/components/ui";
import { UserManager, type AdminUserRow, type BranchPick } from "@/components/UserManager";
import type { Role } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const admin = await requireRole("admin");
  await db();

  const [users, branches] = await Promise.all([
    User.find().sort({ name: 1 }).lean().exec(),
    Branch.find().sort({ name: 1 }).lean().exec(),
  ]);

  // Branch names resolved from the rows we already loaded rather than per user:
  // one query either way, and the name a user sees stays current after a rename.
  const branchNameById = new Map(branches.map((b) => [String(b._id), b.name]));

  const rows: AdminUserRow[] = users.map((u) => {
    const branchId = u.branchId ? String(u.branchId) : undefined;
    return {
      id: String(u._id),
      name: u.name,
      email: u.email,
      roles: u.role as Role[],
      department: u.department,
      branchId,
      branchName: branchId ? branchNameById.get(branchId) : undefined,
      status: u.status,
    };
  });

  const picks: BranchPick[] = branches.map((b) => ({
    id: String(b._id),
    name: b.name,
    prefix: b.prefix,
    active: b.active,
  }));

  return (
    <div>
      <PageHeader
        title="Users & Roles"
        subtitle="Admin controls all role assignments and access"
      />
      <UserManager users={rows} currentUserId={admin.id} branches={picks} />
    </div>
  );
}
