import { requireRole } from "@/lib/auth";
import { PendingBillNewView } from "@/components/views/PendingBillNewView";

export default async function Page() {
  await requireRole("creditcontrol");
  return <PendingBillNewView home="/creditcontrol" />;
}
