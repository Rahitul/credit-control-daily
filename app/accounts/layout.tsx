import { requireRole } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";

export default async function AccountsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireRole("accounts");
  return <AppShell user={user}>{children}</AppShell>;
}
