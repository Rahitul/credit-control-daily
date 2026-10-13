import { requireRole } from "@/lib/auth";
import { PaymentNewView } from "@/components/views/PaymentNewView";

export default async function Page() {
  const user = await requireRole("sales");
  return <PaymentNewView user={user} />;
}
