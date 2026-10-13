"use client";

import React, { useActionState, useMemo, useState } from "react";
import {
  Users,
  Calendar,
  Banknote,
  Hash,
  FileText,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ShoppingBag,
  Info,
  Landmark,
  type LucideIcon,
} from "lucide-react";
import { createSale, updateSale } from "@/app/actions/sales";
import { useTheme } from "@/components/ThemeProvider";
import { toDateInput } from "@/lib/format";
import { resolveDepartmentsAuto, type Role } from "@/lib/pendingBills";
import { DepartmentSelector } from "@/components/DepartmentSelector";
import type { ActionResult } from "@/lib/types";

type Option = { id: string; name: string };

const TooltipInfo = ({ text }: { text: string }) => (
  <div className="group relative inline-flex items-center ml-1.5 text-zinc-400 hover:text-zinc-500 transition-colors">
    <Info className="w-3.5 h-3.5 cursor-help" />
    <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center z-20 pointer-events-none">
      <div className="rounded-md bg-zinc-700 px-2.5 py-1 text-xs font-medium whitespace-nowrap text-zinc-100 shadow-lg">
        {text}
      </div>
      <div className="-mt-1 h-2 w-2 rotate-45 bg-zinc-700"></div>
    </div>
  </div>
);

type FormFieldProps = {
  label: string;
  required?: boolean;
  icon?: LucideIcon;
  error?: string | null;
  children: React.ReactNode;
  className?: string;
  helperText?: string;
};

const FormField = ({
  label,
  required,
  icon: Icon,
  error,
  children,
  className = "",
  helperText,
}: FormFieldProps) => {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label
        className={`flex items-center text-xs font-medium ${
          isDark ? "text-zinc-300" : "text-zinc-700"
        }`}
      >
        {Icon && (
          <Icon
            className={`mr-1.5 h-3.5 w-3.5 shrink-0 ${isDark ? "text-zinc-500" : "text-zinc-400"}`}
          />
        )}
        <span>{label}</span>
        {required && <span className="ml-1 font-bold text-rose-500">*</span>}
        {helperText && <TooltipInfo text={helperText} />}
      </label>
      <div className="relative flex items-center">{children}</div>
      {error && (
        <span className="mt-0.5 flex items-center gap-1 text-xs font-medium text-rose-500">
          <AlertCircle className="h-3 w-3" />
          {error}
        </span>
      )}
    </div>
  );
};

export type SaleValues = {
  id: string;
  customerId: string;
  saleDate: string;
  amount: number;
  referenceId: string;
  billNo: string;
  billDate: string;
};

export function SaleForm({
  customers,
  mode = "create",
  sale,
}: {
  customers: Option[];
  mode?: "create" | "edit";
  sale?: SaleValues;
}) {
  const { theme } = useTheme();
  const [state, formAction, pending] = useActionState<ActionResult | undefined, FormData>(
    mode === "edit" ? updateSale : createSale,
    undefined
  );
  const [selected, setSelected] = useState("");
  const today = useMemo(() => toDateInput(new Date()), []);
  // Department selection state (manual override) for billNo routing
  const [manualDepartments, setManualDepartments] = useState<Role[]>([]);
  const [isManualOverride, setIsManualOverride] = useState(false);

  const isDark = theme === "dark";

  const surface = isDark
    ? "bg-zinc-900 border-zinc-700 shadow-black/30"
    : "bg-white border-zinc-200 shadow-zinc-200/60";
  const muted = isDark ? "text-zinc-400" : "text-zinc-500";
  const sectionTitle = isDark ? "text-zinc-400" : "text-zinc-500";
  const sectionIcon = isDark ? "text-zinc-500" : "text-zinc-400";
  const border = isDark ? "border-zinc-700" : "border-zinc-200";
  const borderSoft = isDark ? "border-zinc-700/80" : "border-zinc-200/80";
  const input =
    "w-full rounded-lg border px-3.5 py-2.5 text-sm transition-all focus:outline-none focus:ring-2 " +
    (isDark
      ? "border-zinc-600 bg-zinc-800 text-zinc-100 placeholder-zinc-500 focus:border-indigo-400 focus:bg-zinc-700 focus:ring-indigo-500/30"
      : "border-zinc-300 bg-zinc-50 text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:bg-white focus:ring-indigo-500/20");

  // Auto-detected departments for the selector (based on billNo)
  const autoDepartments = useMemo(() => {
    const billNoValue = sale?.billNo ?? "";
    if (!billNoValue) return [] as Role[];
    return resolveDepartmentsAuto(billNoValue).departments;
  }, [sale?.billNo]);

  const handleDepartmentChange = (departments: Role[]) => {
    setManualDepartments(departments);
    setIsManualOverride(departments.length > 0 && JSON.stringify(departments.sort()) !== JSON.stringify(autoDepartments.sort()));
  };

  const showSuccess = state?.ok && !state.error;
  const showWarning = state?.ok && !!state.error;
  const showError = state && !state.ok;

  return (
    <form
      action={formAction}
      className={`w-full rounded-2xl border p-6 shadow-xl transition-colors duration-200 sm:p-8 lg:p-10 ${surface}`}
    >
      {mode === "edit" ? <input type="hidden" name="id" value={sale?.id ?? ""} /> : null}

      {showSuccess ? (
        <div
          className={`mb-6 flex items-start gap-3 rounded-xl border p-3.5 text-sm animate-in fade-in duration-200 ${
            isDark
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
          <div className="flex-1">
            <h4 className={`text-sm font-semibold ${isDark ? "text-emerald-100" : "text-emerald-900"}`}>
              Success
            </h4>
            <p className={`mt-0.5 text-xs leading-relaxed ${isDark ? "text-emerald-300" : "text-emerald-700"}`}>
              Sale recorded successfully.
            </p>
          </div>
        </div>
      ) : null}

      {showWarning ? (
        <div
          className={`mb-6 flex items-start gap-3 rounded-xl border p-3.5 text-sm animate-in fade-in duration-200 ${
            isDark
              ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
              : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div className="flex-1">
            <h4 className={`text-sm font-semibold ${isDark ? "text-amber-100" : "text-amber-900"}`}>
              Sale Saved
            </h4>
            <p className={`mt-0.5 text-xs leading-relaxed ${isDark ? "text-amber-300" : "text-amber-700"}`}>
              {state.error}
            </p>
          </div>
        </div>
      ) : null}

      {showError ? (
        <div
          className={`mb-6 flex items-start gap-3 rounded-xl border p-3.5 text-sm animate-in fade-in duration-200 ${
            isDark
              ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
              : "border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" />
          <div className="flex-1">
            <h4 className={`text-sm font-semibold ${isDark ? "text-rose-100" : "text-rose-900"}`}>
              Submission Failed
            </h4>
            <p className={`mt-0.5 text-xs leading-relaxed ${isDark ? "text-rose-300" : "text-rose-700"}`}>
              {state.error}
            </p>
          </div>
        </div>
      ) : null}

      <div className="mb-8 space-y-5">
        <div className={`flex items-center gap-2 border-b pb-2 ${borderSoft}`}>
          <ShoppingBag className={`h-4 w-4 ${sectionIcon}`} />
          <h3 className={`text-xs font-semibold tracking-wider uppercase ${sectionTitle}`}>
            Sale Details
          </h3>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <FormField
            label="Customer / Company"
            required
            icon={Users}
            className="sm:col-span-2 lg:col-span-2"
            helperText="Customer whose outstanding balance will increase"
          >
            <select
              name="customerId"
              required
              className={input}
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              defaultValue={sale?.customerId}
            >
              <option value="" disabled>
                Select customer
              </option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </FormField>

          <FormField
            label="Sale Date"
            required
            icon={Calendar}
            helperText="Used for credit-term / overdue calculation"
          >
            <input
              name="saleDate"
              type="date"
              required
              defaultValue={sale?.saleDate ?? today}
              className={input}
            />
          </FormField>

          <FormField
            label="Sale Amount (৳)"
            required
            icon={Banknote}
            helperText="Invoice total in BDT"
          >
            <div className="relative w-full">
              <input
                name="amount"
                type="number"
                min="0.01"
                step="0.01"
                required
                defaultValue={sale?.amount}
                className={`${input} pr-12`}
                placeholder="0.00"
              />
              <span
                className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium ${muted}`}
              >
                BDT
              </span>
            </div>
          </FormField>
        </div>
      </div>

      <div className="mb-8 space-y-5">
        <div className={`flex items-center gap-2 border-b pb-2 ${borderSoft}`}>
          <FileText className={`h-4 w-4 ${sectionIcon}`} />
          <h3 className={`text-xs font-semibold tracking-wider uppercase ${sectionTitle}`}>
            Additional Information
          </h3>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <FormField
            label="Reference ID"
            icon={Hash}
            helperText="Leave blank to auto-generate SALE-YYYY-NNNN"
          >
            <input
              name="referenceId"
              className={input}
              placeholder="Auto: SALE-2026-0001"
              defaultValue={sale?.referenceId}
            />
          </FormField>

          <FormField
            label="Bill Number"
            required
            icon={Hash}
            helperText="Vendor / supplier bill number for this sale"
          >
            <input
              name="billNo"
              required
              className={input}
              placeholder="e.g. INV-1001"
              defaultValue={sale?.billNo}
            />
          </FormField>

          <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-1">
            <DepartmentSelector
              value={manualDepartments}
              onChange={handleDepartmentChange}
              autoDepartments={autoDepartments}
              isManual={isManualOverride}
              className={input}
              icon={<Landmark className="h-3.5 w-3.5" />}
              helperText="Override the auto-detected department for this bill number. This choice will be remembered for future entries with the same bill number."
            />
            <input type="hidden" name="manualDepartments" value={manualDepartments.join(",")} />
          </div>

          <FormField
            label="Bill Date"
            required
            icon={Calendar}
            helperText="Date printed on the vendor bill"
          >
            <input name="billDate" type="date" required defaultValue={sale?.billDate} className={input} />
          </FormField>
        </div>
      </div>

      <div className={`flex items-center justify-end gap-3 border-t pt-5 ${border}`}>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white shadow-md shadow-indigo-500/20 transition-all hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Saving...</span>
            </>
          ) : (
            <span>Record Sale</span>
          )}
        </button>
      </div>
    </form>
  );
}
