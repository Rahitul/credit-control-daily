import { requireRole } from "@/lib/auth";
import { PendingBillNewView } from "@/components/views/PendingBillNewView";

export const dynamic = "force-dynamic";

export default async function SalesNewPendingBillPage() {
  await requireRole("sales");
  return <PendingBillNewView home="/sales" />;
}
