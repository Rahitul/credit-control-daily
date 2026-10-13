"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <div className="theme-toggle-ring-wrap relative rounded-lg">
      <span aria-hidden className="theme-toggle-ring" />
      <button
        type="button"
        onClick={toggleTheme}
        className={`group relative flex w-full cursor-pointer items-center gap-3 rounded-lg border border-theme bg-theme-surface px-3 py-2.5 text-sm text-theme transition-all duration-200 hover:border-indigo-500/40 hover:text-theme-strong ${className}`}
        aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      >
        {isDark ? (
          <Sun className="h-4 w-4 shrink-0 text-amber-400" />
        ) : (
          <Moon className="h-4 w-4 shrink-0 text-indigo-500" />
        )}
        <span className="font-medium">
          {isDark ? "Light mode" : "Dark mode"}
        </span>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-zinc-500">
          {isDark ? "Light" : "Dark"}
        </span>
      </button>
    </div>
  );
}
