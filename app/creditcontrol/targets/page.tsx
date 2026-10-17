import { requireRole } from "@/lib/auth";
import { CollectionTargetsView } from "@/components/views/CollectionTargetsView";
import type { SearchParams } from "@/components/filters";

export default async function CreditControlCollectionTargetsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireRole("creditcontrol");
  const params = await searchParams;
  return <CollectionTargetsView home="/creditcontrol" params={params} />;
}
