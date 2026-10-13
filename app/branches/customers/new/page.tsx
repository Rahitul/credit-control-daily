import { requireRole } from "@/lib/auth";
import { CustomerNewView } from "@/components/views/CustomerNewView";

export default async function Page() {
  await requireRole("branches");
  return <CustomerNewView />;
}
