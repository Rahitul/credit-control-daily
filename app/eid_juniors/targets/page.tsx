import { requireRole } from "@/lib/auth";
import { CollectionTargetsView } from "@/components/views/CollectionTargetsView";
import type { SearchParams } from "@/components/filters";

export const dynamic = "force-dynamic";

export default async function EidJuniorsCollectionTargetsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireRole("eid_juniors");
  const params = await searchParams;
  return (
    <CollectionTargetsView home="/eid_juniors" params={params} userId={user.id} />
  );
}
