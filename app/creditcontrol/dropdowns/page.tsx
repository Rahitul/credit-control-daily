import { requireRole } from "@/lib/auth";
import { DropdownsView } from "@/components/views/DropdownsView";

export default async function CreditControlDropdownsPage() {
  await requireRole("creditcontrol");
  return <DropdownsView />;
}
