import { requireRole } from "@/lib/auth";
import { BranchesView } from "@/components/views/BranchesView";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireRole("admin");
  return <BranchesView />;
}
