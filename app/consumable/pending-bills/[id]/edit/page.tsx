import { requireRole } from "@/lib/auth";
import { PendingBillEditView } from "@/components/views/PendingBillEditView";

export const dynamic = "force-dynamic";

export default async function ConsumableEditPendingBillPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("consumable");
  const { id } = await params;
  return <PendingBillEditView id={id} home="/consumable" department="consumable" />;
}
