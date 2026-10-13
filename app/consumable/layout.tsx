import { requireRole } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireRole("consumable");
  return <AppShell user={user}>{children}</AppShell>;
}
