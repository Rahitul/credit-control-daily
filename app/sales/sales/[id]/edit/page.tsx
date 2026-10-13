import { requireRole } from "@/lib/auth";
import { SaleEditView } from "@/components/views/SaleEditView";

export const dynamic = "force-dynamic";

export default async function SalesEditSalePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("sales");
  const { id } = await params;
  return <SaleEditView id={id} home="sales" department="sales" />;
}
