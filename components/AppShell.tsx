"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut, Menu, X } from "lucide-react";
import { logout } from "@/app/actions/auth";
import { navForRoles, type NavItem } from "@/lib/nav";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ChatWidget } from "@/components/ChatWidget";
import { ROLE_LABELS, type SessionUser } from "@/lib/types";

export function AppShell({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const items: NavItem[] = navForRoles(user.roles);
  const home = items[0]?.href ?? "/";

  const isActive = (href: string) =>
    href === home ? pathname === home : pathname.startsWith(href);

  const handleLogout = async () => {
    await logout();
    router.push("/");
    router.refresh();
  };

  const nav = (
    <nav className="sidebar-nav flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain py-1">
      {items.map((item) => {
        const Icon = item.icon;
        const active = isActive(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className={`group nav-active flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all duration-200 ${
              active
                ? "bg-gradient-to-r from-indigo-600/25 to-purple-600/15 border border-indigo-500/40 shadow-[0_0_20px_rgba(99,102,241,0.15)]"
                : "nav-link border border-transparent"
            }`}
          >
            <Icon
              className={`h-4 w-4 shrink-0 ${
                active ? "nav-active-icon text-indigo-400" : "nav-link-icon"
              }`}
            />
            <span className="font-medium">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );

  const brand = (
    <div className="mb-6 px-1">
      <h1 className="text-base font-bold tracking-tight text-theme">
        Credit Control Daily
      </h1>
      <p className="mt-1 text-xs text-theme-muted">Internal credit management</p>
    </div>
  );

  const userCard = (
    <div className="shrink-0 border-t border-theme pt-4 px-1">
      <div className="mb-3">
        <ThemeToggle />
      </div>
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-600 to-purple-600 text-xs font-bold text-white">
          {user.name
            .split(" ")
            .map((p) => p[0])
            .slice(0, 2)
            .join("")
            .toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-theme">{user.name}</p>
          <p className="truncate text-xs text-theme-muted">
            {user.roles.map((r) => ROLE_LABELS[r]).join(", ")}
          </p>
        </div>
        <button
          onClick={handleLogout}
          className="icon-btn"
          aria-label="Sign out"
          title="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-theme text-theme">
      {/* Desktop sidebar */}
      <aside className="theme-sidebar fixed inset-y-0 left-0 z-30 hidden w-64 flex-col overflow-hidden p-4 lg:flex">
        <div className="shrink-0">{brand}</div>
        {nav}
        {userCard}
      </aside>

      {/* Mobile top bar */}
      <div className="theme-topbar fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between px-4 lg:hidden">
        <span className="text-sm font-bold text-theme">Credit Control Daily</span>
        <div className="flex items-center gap-2">
          <ThemeToggle className="w-auto! px-2.5 py-1.5" />
          <button
            onClick={() => setOpen(!open)}
            className="icon-btn"
            aria-label="Toggle menu"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col overflow-hidden bg-theme p-4 border-r border-theme">
            <div className="flex shrink-0 items-center justify-between">
              {brand}
              <button
                onClick={() => setOpen(false)}
                className="icon-btn"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {nav}
            {userCard}
          </aside>
        </div>
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col pt-14 lg:pt-0 lg:pl-64">
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>

      <ChatWidget />
    </div>
  );
}
