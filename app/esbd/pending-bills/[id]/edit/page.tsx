import { requireRole } from "@/lib/auth";
import { PendingBillEditView } from "@/components/views/PendingBillEditView";

export const dynamic = "force-dynamic";

export default async function EsbdEditPendingBillPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("esbd");
  const { id } = await params;
  return <PendingBillEditView id={id} home="/esbd" department="esbd" />;
}
