import { requireRole } from "@/lib/auth";
import { CustomersView } from "@/components/views/CustomersView";
import type { SearchParams } from "@/components/filters";

export default async function AccountsCustomersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireRole("accounts");
  const params = await searchParams;
  return <CustomersView user={user} params={params} home="/accounts" />;
}
