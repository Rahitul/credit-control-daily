import { requireRole } from "@/lib/auth";
import { DashboardView } from "@/components/views/DashboardView";

export default async function Page() {
  const user = await requireRole("consumable");
  return <DashboardView user={user} department="consumable" />;
}
