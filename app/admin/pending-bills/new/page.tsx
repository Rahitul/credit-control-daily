import { requireRole } from "@/lib/auth";
import { PendingBillNewView } from "@/components/views/PendingBillNewView";

export default async function AdminPendingBillNewPage() {
  await requireRole("admin");
  return <PendingBillNewView home="/admin" />;
}
