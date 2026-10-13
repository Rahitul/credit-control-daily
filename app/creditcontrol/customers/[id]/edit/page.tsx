import { requireRole } from "@/lib/auth";
import { CustomerEditView } from "@/components/views/CustomerEditView";

export const dynamic = "force-dynamic";

export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("creditcontrol");
  const { id } = await params;
  return <CustomerEditView id={id} />;
}
