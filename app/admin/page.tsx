import { requireRole } from "@/lib/auth";
import { isDashboardRange } from "@/lib/dashboard";
import { OverviewDashboard } from "@/components/views/OverviewDashboard";

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const user = await requireRole("admin");
  const params = await searchParams;
  return (
    <OverviewDashboard
      user={user}
      range={isDashboardRange(params.range) ? params.range : "all"}
    />
  );
}
