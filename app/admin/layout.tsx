import { requireRole } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireRole("admin");
  return <AppShell user={user}>{children}</AppShell>;
}
