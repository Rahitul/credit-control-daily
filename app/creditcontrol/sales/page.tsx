import { requireRole } from "@/lib/auth";
import { SalesView } from "@/components/views/SalesView";
import type { SearchParams } from "@/components/filters";

export default async function CreditControlSalesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireRole("creditcontrol");
  const params = await searchParams;
  return <SalesView user={user} params={params} home="/creditcontrol" department={null} />;
}
