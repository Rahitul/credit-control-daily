import { requireRole } from "@/lib/auth";
import { CollectionTargetsView } from "@/components/views/CollectionTargetsView";
import type { SearchParams } from "@/components/filters";

export const dynamic = "force-dynamic";

export default async function EsbdCollectionTargetsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireRole("esbd");
  const params = await searchParams;
  return <CollectionTargetsView home="/esbd" params={params} userId={user.id} />;
}
