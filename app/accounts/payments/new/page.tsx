import { requireRole } from "@/lib/auth";
import { PaymentNewView } from "@/components/views/PaymentNewView";
import { ENTRY_ROLES } from "@/lib/nav";

export default async function NewPaymentPage() {
  const user = await requireRole(...ENTRY_ROLES);
  return <PaymentNewView user={user} />;
}
