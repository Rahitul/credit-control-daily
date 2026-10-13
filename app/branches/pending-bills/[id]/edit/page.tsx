import { requireRole } from "@/lib/auth";
import { PendingBillEditView } from "@/components/views/PendingBillEditView";

export const dynamic = "force-dynamic";

export default async function BranchesEditPendingBillPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("branches");
  const { id } = await params;
  return <PendingBillEditView id={id} home="/branches" department="branches" />;
}
