import { requireRole } from "@/lib/auth";
import { CollectionTargetsView } from "@/components/views/CollectionTargetsView";
import type { SearchParams } from "@/components/filters";

export const dynamic = "force-dynamic";

export default async function ConsumableCollectionTargetsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireRole("consumable");
  const params = await searchParams;
  return <CollectionTargetsView home="/consumable" params={params} userId={user.id} />;
}
