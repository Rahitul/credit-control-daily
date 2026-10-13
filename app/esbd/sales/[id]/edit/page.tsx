import { requireRole } from "@/lib/auth";
import { SaleEditView } from "@/components/views/SaleEditView";

export const dynamic = "force-dynamic";

export default async function EsbdEditSalePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("esbd");
  const { id } = await params;
  return <SaleEditView id={id} home="esbd" department="esbd" />;
}
