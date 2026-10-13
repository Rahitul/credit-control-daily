import { requireRole } from "@/lib/auth";
import { CustomersView } from "@/components/views/CustomersView";
import type { SearchParams } from "@/components/filters";

export default async function CreditControlCustomersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireRole("creditcontrol");
  const params = await searchParams;
  return <CustomersView user={user} params={params} home="/creditcontrol" />;
}
