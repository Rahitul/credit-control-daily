import { requireRole } from "@/lib/auth";
import { SaleEditView } from "@/components/views/SaleEditView";

export const dynamic = "force-dynamic";

export default async function EidEditSalePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("eid");
  const { id } = await params;
  return <SaleEditView id={id} home="eid" department="eid" />;
}
