import { requireRole } from "@/lib/auth";
import { PaymentsView } from "@/components/views/PaymentsView";
import type { SearchParams } from "@/components/filters";

export default async function AccountsPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireRole("accounts");
  const params = await searchParams;
  return <PaymentsView user={user} params={params} home="/accounts" />;
}
