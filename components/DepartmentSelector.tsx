"use client";

import React, { useMemo } from "react";
import { useTheme } from "@/components/ThemeProvider";
import { ROLE_LABELS, type Role } from "@/lib/types";

interface DepartmentSelectorProps {
  /** Currently selected departments */
  value: Role[];
  /** Callback when selection changes */
  onChange: (departments: Role[]) => void;
  /** Auto-detected departments (for display) */
  autoDepartments: Role[];
  /** Whether the current selection is a manual override */
  isManual: boolean;
  /** Input className for theme-aware styling */
  className?: string;
  /** Disabled state */
  disabled?: boolean;
  /** Label for the field */
  label?: string;
  /** Helper text */
  helperText?: string;
  /** Icon */
  icon?: React.ReactNode;
}

const DEPARTMENT_OPTIONS: { value: Role; label: string }[] = [
  { value: "sales", label: "Sales" },
  { value: "consumable", label: "Consumable" },
  { value: "eid", label: "EID" },
  { value: "esbd", label: "ESBD" },
  { value: "branches", label: "Branches" },
];

export function DepartmentSelector({
  value,
  onChange,
  autoDepartments,
  isManual,
  className = "",
  disabled = false,
  label = "Department",
  helperText,
  icon,
}: DepartmentSelectorProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const input = useMemo(() => {
    const base = "w-full rounded-lg border px-3.5 py-2.5 text-sm transition-all focus:outline-none focus:ring-2 ";
    return (
      base +
      (isDark
        ? "border-zinc-600 bg-zinc-800 text-zinc-100 placeholder-zinc-500 focus:border-indigo-400 focus:bg-zinc-700 focus:ring-indigo-500/30"
        : "border-zinc-300 bg-zinc-50 text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:bg-white focus:ring-indigo-500/20")
    ) + " " + className;
  }, [isDark, className]);

  const muted = isDark ? "text-zinc-400" : "text-zinc-500";

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = Array.from(e.target.selectedOptions).map((opt) => opt.value as Role);
    onChange(selected);
  };

  const autoDisplayValue = useMemo(() => {
    if (!autoDepartments.length) return "Accounts only (no matching prefix)";
    return autoDepartments.map((d) => ROLE_LABELS[d]).join(" + ");
  }, [autoDepartments]);

  return (
    <div className="flex flex-col gap-1.5">
      <label className={`flex items-center text-xs font-medium ${isDark ? "text-zinc-300" : "text-zinc-700"}`}>
        {icon && <span className="mr-1.5">{icon}</span>}
        <span>{label}</span>
        {helperText && (
          <span className="ml-1.5 group relative inline-flex items-center text-zinc-400 hover:text-zinc-500 transition-colors">
            <svg className="w-3.5 h-3.5 cursor-help" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center z-20 pointer-events-none">
              <div className="rounded-md bg-zinc-700 px-2.5 py-1 text-xs font-medium whitespace-nowrap text-zinc-100 shadow-lg">
                {helperText}
              </div>
              <div className="-mt-1 h-2 w-2 rotate-45 bg-zinc-700"></div>
            </div>
          </span>
        )}
      </label>
      <div className="relative flex items-center">
        <select
          multiple
          value={value}
          onChange={handleChange}
          disabled={disabled}
          className={`${input} pr-10 cursor-pointer ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          {DEPARTMENT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <svg
          className="absolute right-3 h-4 w-4 pointer-events-none text-zinc-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-1">
        <span className={`text-[11px] ${isManual ? "font-medium text-amber-600" : muted}`}>
          {isManual ? "✎ Manual override" : `Auto: ${autoDisplayValue}`}
        </span>
      </div>
    </div>
  );
}