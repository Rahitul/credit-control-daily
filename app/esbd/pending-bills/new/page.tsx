import { requireRole } from "@/lib/auth";
import { PendingBillNewView } from "@/components/views/PendingBillNewView";

export const dynamic = "force-dynamic";

export default async function EsbdNewPendingBillPage() {
  await requireRole("esbd");
  return <PendingBillNewView home="/esbd" />;
}
