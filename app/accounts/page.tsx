import { requireRole } from "@/lib/auth";
import { isDashboardRange } from "@/lib/dashboard";
import { OverviewDashboard } from "@/components/views/OverviewDashboard";

export default async function AccountsDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const user = await requireRole("accounts");
  const params = await searchParams;
  return (
    <OverviewDashboard
      user={user}
      range={isDashboardRange(params.range) ? params.range : "all"}
    />
  );
}
