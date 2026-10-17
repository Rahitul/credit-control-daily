import { requireRole } from "@/lib/auth";
import { CollectionTargetsView } from "@/components/views/CollectionTargetsView";
import type { SearchParams } from "@/components/filters";

export default async function AccountsCollectionTargetsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireRole("accounts");
  const params = await searchParams;
  return <CollectionTargetsView home="/accounts" params={params} />;
}
