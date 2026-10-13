import { requireRole } from "@/lib/auth";
import { PendingBillNewView } from "@/components/views/PendingBillNewView";

export default async function Page() {
  await requireRole("accounts");
  return <PendingBillNewView home="/accounts" />;
}
