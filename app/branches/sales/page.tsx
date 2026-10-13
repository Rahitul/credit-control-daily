import { requireRole } from "@/lib/auth";
import { SalesView } from "@/components/views/SalesView";
import type { SearchParams } from "@/components/filters";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireRole("branches");
  const params = await searchParams;
  return <SalesView user={user} params={params} home="/branches" department="branches" />;
}
