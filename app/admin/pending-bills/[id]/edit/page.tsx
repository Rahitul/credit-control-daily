import { requireRole } from "@/lib/auth";
import { PendingBillEditView } from "@/components/views/PendingBillEditView";

export default async function AdminPendingBillEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("admin");
  const { id } = await params;
  return <PendingBillEditView id={id} home="/admin" />;
}
