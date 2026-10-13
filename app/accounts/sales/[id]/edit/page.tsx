import { requireRole } from "@/lib/auth";
import { SaleEditView } from "@/components/views/SaleEditView";

export const dynamic = "force-dynamic";

export default async function AccountsEditSalePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("accounts");
  const { id } = await params;
  return <SaleEditView id={id} home="accounts" department={null} />;
}
