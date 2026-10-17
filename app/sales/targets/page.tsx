import { requireRole } from "@/lib/auth";
import { CollectionTargetsView } from "@/components/views/CollectionTargetsView";
import type { SearchParams } from "@/components/filters";

export const dynamic = "force-dynamic";

export default async function SalesCollectionTargetsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireRole("sales");
  const params = await searchParams;
  return <CollectionTargetsView home="/sales" params={params} userId={user.id} />;
}
