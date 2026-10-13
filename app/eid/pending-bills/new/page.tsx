import { requireRole } from "@/lib/auth";
import { PendingBillNewView } from "@/components/views/PendingBillNewView";

export const dynamic = "force-dynamic";

export default async function EidNewPendingBillPage() {
  await requireRole("eid");
  return <PendingBillNewView home="/eid" />;
}
