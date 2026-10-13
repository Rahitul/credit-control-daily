import { requireRole } from "@/lib/auth";
import { DistributeView } from "@/components/views/DistributeView";
import type { SearchParams } from "@/components/filters";

export const dynamic = "force-dynamic";

export default async function AdminDistributePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireRole("admin");
  return <DistributeView searchParams={searchParams} />;
}
