import { requireRole } from "@/lib/auth";
import { PendingBillEditView } from "@/components/views/PendingBillEditView";

export const dynamic = "force-dynamic";

export default async function SalesEditPendingBillPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("sales");
  const { id } = await params;
  return <PendingBillEditView id={id} home="/sales" department="sales" />;
}
