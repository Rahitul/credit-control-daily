import { requireRole } from "@/lib/auth";
import { SaleNewView } from "@/components/views/SaleNewView";

export default async function NewSalePage() {
  await requireRole("accounts");
  return <SaleNewView />;
}

