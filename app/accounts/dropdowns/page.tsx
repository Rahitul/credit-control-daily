import { requireRole } from "@/lib/auth";
import { DropdownsView } from "@/components/views/DropdownsView";

export default async function AccountsDropdownsPage() {
  await requireRole("accounts");
  return <DropdownsView />;
}
