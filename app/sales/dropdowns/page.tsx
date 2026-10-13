import { requireRole } from "@/lib/auth";
import { DropdownsView } from "@/components/views/DropdownsView";

export default async function Page() {
  await requireRole("sales");
  return <DropdownsView />;
}
