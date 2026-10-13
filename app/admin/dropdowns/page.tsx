import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { Dropdown } from "@/lib/models/Dropdown";
import { PageHeader } from "@/components/ui";
import { DropdownManager, type DropdownRow } from "@/components/DropdownManager";

export const dynamic = "force-dynamic";

export default async function AdminDropdownsPage() {
  await requireRole("admin");
  await db();

  const docs = await Dropdown.find()
    .sort({ type: 1, value: 1 })
    .lean()
    .exec();

  const rows: DropdownRow[] = docs.map((d) => ({
    id: String(d._id),
    type: d.type,
    value: d.value,
  }));

  return (
    <div>
      <PageHeader
        title="Manage Dropdowns"
        subtitle="Manage category, branch, and payment form dropdown options"
      />
      <DropdownManager rows={rows} />
    </div>
  );
}
