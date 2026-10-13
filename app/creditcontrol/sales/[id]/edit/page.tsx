import { requireRole } from "@/lib/auth";
import { SaleEditView } from "@/components/views/SaleEditView";

export const dynamic = "force-dynamic";

export default async function CreditControlEditSalePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("creditcontrol");
  const { id } = await params;
  return <SaleEditView id={id} home="/creditcontrol" department={null} />;
}
