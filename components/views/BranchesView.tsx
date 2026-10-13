import { db } from "@/lib/db";
import { listBranches } from "@/lib/branchesData";
import { PageHeader } from "@/components/ui";
import { BranchManager, type BranchRow } from "@/components/BranchManager";

export const dynamic = "force-dynamic";

export async function BranchesView() {
  await db();
  const branches = await listBranches();

  const rows: BranchRow[] = branches.map((b) => ({
    id: String(b._id),
    name: b.name,
    prefix: b.prefix,
    active: b.active,
    note: b.note ?? "",
  }));

  return (
    <div>
      <PageHeader
        title="Branches"
        subtitle="Branch offices and the bill prefix that routes their bills to the branches app"
      />
      <BranchManager rows={rows} />
    </div>
  );
}
