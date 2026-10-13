import { requireRole } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";

export default async function CreditControlLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireRole("creditcontrol");
  return <AppShell user={user}>{children}</AppShell>;
}
