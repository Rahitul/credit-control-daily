import { requireRole } from "@/lib/auth";
import { DashboardView } from "@/components/views/DashboardView";

export default async function Page() {
  const user = await requireRole("esbd");
  return <DashboardView user={user} department="esbd" />;
}
