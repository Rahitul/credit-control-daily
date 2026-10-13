import { requireRole } from "@/lib/auth";
import { PendingBillEditView } from "@/components/views/PendingBillEditView";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("accounts");
  const { id } = await params;
  return <PendingBillEditView id={id} home="/accounts" />;
}
