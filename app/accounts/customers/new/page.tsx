import { requireRole } from "@/lib/auth";
import { CustomerNewView } from "@/components/views/CustomerNewView";

export default async function NewCustomerPage() {
  await requireRole("accounts");
  return <CustomerNewView />;
}
