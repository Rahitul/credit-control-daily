import { requireRole } from "@/lib/auth";
import { PendingBillEditView } from "@/components/views/PendingBillEditView";

export const dynamic = "force-dynamic";

export default async function EidEditPendingBillPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("eid");
  const { id } = await params;
  return <PendingBillEditView id={id} home="/eid" department="eid" />;
}
