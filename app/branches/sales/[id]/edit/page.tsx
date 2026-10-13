import { requireRole } from "@/lib/auth";
import { SaleEditView } from "@/components/views/SaleEditView";

export const dynamic = "force-dynamic";

export default async function BranchesEditSalePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("branches");
  const { id } = await params;
  return <SaleEditView id={id} home="/branches" department="branches" />;
}
