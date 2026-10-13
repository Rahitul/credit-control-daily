import { requireRole } from "@/lib/auth";
import { SaleEditView } from "@/components/views/SaleEditView";

export const dynamic = "force-dynamic";

export default async function ConsumableEditSalePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("consumable");
  const { id } = await params;
  return <SaleEditView id={id} home="consumable" department="consumable" />;
}
