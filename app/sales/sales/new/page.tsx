import { requireRole } from "@/lib/auth";
import { SaleNewView } from "@/components/views/SaleNewView";

export default async function Page() {
  await requireRole("sales");
  return <SaleNewView />;
}

