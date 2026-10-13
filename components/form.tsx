"use client";

import { useTheme } from "@/components/ThemeProvider";

export function SuccessBanner({ message }: { message?: string }) {
  const { theme } = useTheme();
  if (!message) return null;
  const isDark = theme === "dark";
  return (
    <div
      className={`mb-4 rounded-lg border px-4 py-2.5 text-sm ${
        isDark
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
          : "border-emerald-200 bg-emerald-50 text-emerald-800"
      }`}
    >
      {message}
    </div>
  );
}

export function ErrorBanner({ message }: { message?: string }) {
  const { theme } = useTheme();
  if (!message) return null;
  const isWarning = message.startsWith("Warning");
  const isDark = theme === "dark";
  const cls = isWarning
    ? isDark
      ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
      : "border-amber-200 bg-amber-50 text-amber-800"
    : isDark
      ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
      : "border-rose-200 bg-rose-50 text-rose-800";
  return (
    <div className={`mb-4 rounded-lg border px-4 py-2.5 text-sm ${cls}`} role="alert">
      {message}
    </div>
  );
}

export function Field({
  label,
  children,
  required,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  className?: string;
}) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span
        className={`text-sm font-medium ${isDark ? "text-zinc-300" : "text-zinc-700"}`}
      >
        {label}
        {required ? <span className="font-bold text-rose-500"> *</span> : null}
      </span>
      {children}
    </label>
  );
}
