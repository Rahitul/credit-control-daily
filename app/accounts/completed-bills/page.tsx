import { requireRole } from "@/lib/auth";
import { PendingBillsView } from "@/components/views/PendingBillsView";
import type { SearchParams } from "@/components/filters";

export const dynamic = "force-dynamic";

export default async function AccountsCompletedBillsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireRole("accounts");
  const params = await searchParams;
  return <PendingBillsView params={params} home="accounts" completed />;
}
