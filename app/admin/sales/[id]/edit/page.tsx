import { requireRole } from "@/lib/auth";
import { SaleEditView } from "@/components/views/SaleEditView";

export const dynamic = "force-dynamic";

export default async function AdminEditSalePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("admin");
  const { id } = await params;
  return <SaleEditView id={id} home="admin" department={null} />;
}
