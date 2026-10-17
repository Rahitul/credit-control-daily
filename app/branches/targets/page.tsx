import { requireRole } from "@/lib/auth";
import { CollectionTargetsView } from "@/components/views/CollectionTargetsView";
import type { SearchParams } from "@/components/filters";

export const dynamic = "force-dynamic";

export default async function BranchesCollectionTargetsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireRole("branches");
  const params = await searchParams;
  return <CollectionTargetsView home="/branches" params={params} userId={user.id} />;
}
