import { requireRole } from "@/lib/auth";
import { PendingBillNewView } from "@/components/views/PendingBillNewView";

export const dynamic = "force-dynamic";

export default async function BranchesNewPendingBillPage() {
  await requireRole("branches");
  return <PendingBillNewView home="/branches" />;
}
