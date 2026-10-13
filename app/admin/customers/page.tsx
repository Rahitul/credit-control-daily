import { requireRole } from "@/lib/auth";
import { CustomersView } from "@/components/views/CustomersView";
import type { SearchParams } from "@/components/filters";

export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireRole("admin");
  const params = await searchParams;
  return <CustomersView user={user} params={params} home="/admin" />;
}
