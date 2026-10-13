import { requireRole } from "@/lib/auth";
import { PendingBillsView } from "@/components/views/PendingBillsView";
import type { SearchParams } from "@/components/filters";

export const dynamic = "force-dynamic";

export default async function EidJuniorsPendingBillsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireRole("eid_juniors");
  const params = await searchParams;
  return (
    <PendingBillsView params={params} home="/eid_juniors" department="eid" />
  );
}
