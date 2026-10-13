"use client";

import React from "react";
import { useActionState, useMemo, useState } from "react";
import {
  Building2,
  Tag,
  MapPin,
  Users,
  User,
  Phone,
  GitFork,
  Calendar,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Info,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { createCustomer, updateCustomer } from "@/app/actions/customers";
import { SearchSelect } from "@/components/SearchSelect";
import { useTheme } from "@/components/ThemeProvider";
import { formatBDT } from "@/lib/format";
import { DEFAULT_CUSTOMER_GROUP, type ActionResult } from "@/lib/types";

/** The editable subset of a Customer — the audit + approval fields are not editable. */
export type CustomerFormValues = {
  id?: string;
  name?: string;
  address?: string;
  contactPerson?: string;
  contactNumber?: string;
  category?: string;
  group?: string;
  branch?: string;
  creditLimitDays?: number;
  /** Hand-set term override — `null`/absent = automatic (derived from open bills). */
  termMinDays?: number | null;
  termMaxDays?: number | null;
};

/**
 * Read-only money summary shown at the bottom of the form in edit mode.
 *
 * Deliberately a subset of `CustomerCreditRow` — only plain numbers cross the
 * server/client boundary, never a Mongoose document. `outstanding` arrives
 * already computed by `getCustomerCredits` and is the BILLS register only
 * (`billsOutstanding`); `salesOutstanding` is kept separate here so the card
 * cannot be mistaken for `outstanding` and so sale balances are visible without
 * being summed into the figure the bills pages report.
 */
export type CustomerMoneySummary = {
  totalSales: number;
  billsOutstanding: number;
  salesOutstanding: number;
  totalCollected: number;
  outstanding: number;
  status: "within" | "overdue";
  overdueAmount: number;
};

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

/** One figure in the read-only money summary. Formatting lives in `formatBDT` (৳ BDT). */
const MoneyTile = ({
  label,
  value,
  sub,
  isDark,
  emphasis = false,
}: {
  label: string;
  value: number;
  sub: string;
  isDark: boolean;
  emphasis?: boolean;
}) => (
  <div
    className={`rounded-lg border p-3 ${
      emphasis
        ? isDark
          ? "border-rose-500/30 bg-rose-500/5"
          : "border-rose-200 bg-rose-50/50"
        : isDark
          ? "border-zinc-700/70 bg-zinc-900/40"
          : "border-zinc-200 bg-white/60"
    }`}
  >
    <p className={`text-[11px] font-medium uppercase tracking-wide ${isDark ? "text-zinc-500" : "text-zinc-500"}`}>
      {label}
    </p>
    <p
      className={`mt-1 text-lg font-semibold tabular-nums ${
        emphasis ? (isDark ? "text-rose-300" : "text-rose-600") : isDark ? "text-zinc-100" : "text-zinc-900"
      }`}
    >
      {formatBDT(value)}
    </p>
    <p className={`mt-0.5 text-[11px] ${isDark ? "text-zinc-500" : "text-zinc-400"}`}>{sub}</p>
  </div>
);

export function CustomerForm({
  categories = [],
  branches = [],
  mode = "create",
  customer,
  summary,
  derivedTerm = null,
}: {
  categories?: string[];
  branches?: string[];
  mode?: "create" | "edit";
  customer?: CustomerFormValues;
  summary?: CustomerMoneySummary;
  /**
   * The term the Customers list would show WITHOUT an override ("30 d" or
   * "7–30 d", derived from this party's open bills). Shown in the override
   * helper text so the person editing can see what they are about to pin.
   * `null` when there is nothing derived (no dated open bills).
   */
  derivedTerm?: string | null;
}) {
  const { theme } = useTheme();
  const isEdit = mode === "edit" && !!customer?.id;
  const [branch, setBranch] = useState(customer?.branch ?? "");

  // The stored branch is ALWAYS merged into the options. A customer can hold a
  // branch that is absent from Manage Dropdowns, and a plain list would render
  // that as an empty box — which would then save as an empty branch and silently
  // wipe the value.
  const branchOptions = useMemo(() => {
    const all = new Set(branches);
    const current = branch.trim();
    if (current) all.add(current);
    return [...all].sort().map((b) => ({ value: b, label: b }));
  }, [branches, branch]);

  const [state, formAction, pending] = useActionState<ActionResult | undefined, FormData>(
    isEdit ? updateCustomer : createCustomer,
    undefined
  );

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

  return (
    <form
      action={formAction}
      className={`w-full rounded-2xl border p-6 shadow-xl transition-colors duration-200 sm:p-8 lg:p-10 ${surface}`}
    >
      {isEdit ? <input type="hidden" name="id" value={customer.id} /> : null}

      {state?.ok ? (
        <div className={`mb-6 flex items-start gap-3 rounded-xl border p-3.5 text-sm animate-in fade-in duration-200 ${
          isDark
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
            : "border-emerald-200 bg-emerald-50 text-emerald-800"
        }`}>
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
          <div className="flex-1">
            <h4 className={`text-sm font-semibold ${isDark ? "text-emerald-100" : "text-emerald-900"}`}>
              Success
            </h4>
            <p className={`mt-0.5 text-xs leading-relaxed ${isDark ? "text-emerald-300" : "text-emerald-700"}`}>
              {isEdit
                ? "Customer updated."
                : "Customer created and submitted for approval. It stays unavailable for sales, payments, and reports until an admin approves it."}
            </p>
          </div>
        </div>
      ) : null}

      {state && !state.ok ? (
        <div className={`mb-6 flex items-start gap-3 rounded-xl border p-3.5 text-sm animate-in fade-in duration-200 ${
          isDark
            ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
            : "border-rose-200 bg-rose-50 text-rose-800"
        }`}>
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
          <Building2 className={`h-4 w-4 ${sectionIcon}`} />
          <h3 className={`text-xs font-semibold tracking-wider uppercase ${sectionTitle}`}>
            General Information
          </h3>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <FormField
            label="Customer / Company Name"
            required
            icon={Building2}
            className="sm:col-span-2 lg:col-span-2"
            helperText="Official legal entity or trade name"
          >
            <input
              name="name"
              required
              className={input}
              defaultValue={customer?.name ?? ""}
              placeholder="e.g. Acme Traders Ltd"
            />
          </FormField>

          <FormField label="Category" icon={Tag}>
            <select
              name="category"
              defaultValue={customer?.category ?? ""}
              className={input}
            >
              <option value="">Select Category...</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Address" icon={MapPin} className="sm:col-span-2 lg:col-span-2">
            <input
              name="address"
              className={input}
              defaultValue={customer?.address ?? ""}
              placeholder="Street address, city, region, postal code"
            />
          </FormField>

          <FormField
            label="Group"
            icon={Users}
            helperText="Group classification for multi-entity companies"
          >
            <div className="flex w-full flex-col gap-1">
              <input
                name="group"
                className={input}
                defaultValue={customer?.group ?? DEFAULT_CUSTOMER_GROUP}
                placeholder={DEFAULT_CUSTOMER_GROUP}
              />
            </div>
          </FormField>
        </div>
      </div>

      <div className="mb-8 space-y-5">
        <div className={`flex items-center gap-2 border-b pb-2 ${borderSoft}`}>
          <User className={`h-4 w-4 ${sectionIcon}`} />
          <h3 className={`text-xs font-semibold tracking-wider uppercase ${sectionTitle}`}>
            Contact & Location
          </h3>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <FormField label="Contact Person Name" icon={User}>
            <input
              name="contactPerson"
              className={input}
              defaultValue={customer?.contactPerson ?? ""}
              placeholder="e.g. John Rahman"
            />
          </FormField>

          <FormField label="Contact Number" icon={Phone}>
            <input
              name="contactNumber"
              type="tel"
              className={input}
              defaultValue={customer?.contactNumber ?? ""}
              placeholder="e.g. +8801712345678"
            />
          </FormField>

          <FormField label="Branch" icon={GitFork}>
            <SearchSelect
              name="branch"
              options={branchOptions}
              value={branch}
              onValueChange={(v) => setBranch(v)}
              placeholder="Search branch..."
              emptyMessage="No branch matches that search"
              className={input}
            />
          </FormField>
        </div>
      </div>

      <div className="mb-8 space-y-5">
        <div className={`flex items-center gap-2 border-b pb-2 ${borderSoft}`}>
          <Calendar className={`h-4 w-4 ${sectionIcon}`} />
          <h3 className={`text-xs font-semibold tracking-wider uppercase ${sectionTitle}`}>
            Financial & Credit Terms
          </h3>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <FormField
            label="Credit Limit (Days)"
            icon={Calendar}
            helperText="Standard payment cycle duration"
          >
            <div className="relative w-full">
              <input
                name="creditLimitDays"
                type="number"
                min="0"
                step="1"
                className={`${input} pr-14`}
                defaultValue={customer?.creditLimitDays ?? ""}
                placeholder="e.g. 30"
              />
              <span
                className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium ${muted}`}
              >
                days
              </span>
            </div>
          </FormField>

          {/* Manual term override. Blank = AUTOMATIC: the Customers list derives
              the term live from this party's open bills. Min only = a SINGLE
              number (e.g. 7 → "7 d"); Min + Max = the spread ("7–30 d"). Once
              saved, the value is pinned to the database and later pending-bill
              imports can no longer move it. */}
          <FormField
            label="Term Override — Min (days)"
            icon={Calendar}
            helperText={
              derivedTerm
                ? `Blank keeps it automatic — currently ${derivedTerm} from open bills. Fill Min only for a single number.`
                : "Blank keeps it automatic (derived from open bills). Fill Min only for a single number."
            }
          >
            <div className="relative w-full">
              <input
                name="termMinDays"
                type="number"
                min="0"
                step="1"
                className={`${input} pr-14`}
                defaultValue={customer?.termMinDays ?? ""}
                placeholder="Automatic"
              />
              <span
                className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium ${muted}`}
              >
                days
              </span>
            </div>
          </FormField>
          <FormField
            label="Term Override — Max (days)"
            icon={Calendar}
            helperText="Optional upper bound of the spread — e.g. 30 turns Min 7 into 7–30 days. Leave blank for a single number. Leave BOTH blank to keep the term automatic."
          >
            <div className="relative w-full">
              <input
                name="termMaxDays"
                type="number"
                min="0"
                step="1"
                className={`${input} pr-14`}
                defaultValue={customer?.termMaxDays ?? ""}
                placeholder="Single number"
              />
              <span
                className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium ${muted}`}
              >
                days
              </span>
            </div>
          </FormField>
        </div>
      </div>

      {/* Read-only money summary — edit mode only. Sits above the footer so the
          submit button stays last, and submits nothing: it is context for the person
          checking the terms, not part of the update. */}
      {isEdit && summary ? (
        <div className={`mt-6 rounded-xl border p-4 sm:p-5 ${isDark ? "border-zinc-700/80 bg-zinc-800/40" : "border-zinc-200 bg-zinc-50/60"}`}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Wallet className={`h-4 w-4 ${sectionIcon}`} />
              <h3 className={`text-xs font-semibold tracking-wider uppercase ${sectionTitle}`}>
                Money Summary
              </h3>
            </div>
            <span className={`pill ${summary.status === "overdue" ? "pill-red" : "pill-green"}`}>
              {summary.status === "overdue" ? "Overdue" : "Within terms"}
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MoneyTile
              label="Total Sales"
              value={summary.totalSales}
              sub="sales register"
              isDark={isDark}
            />
            <MoneyTile
              label="Outstanding"
              value={summary.outstanding}
              sub="open pending bills"
              isDark={isDark}
              emphasis={summary.outstanding > 0}
            />
            <MoneyTile
              label="Collected"
              value={summary.totalCollected}
              sub="approved payments"
              isDark={isDark}
            />
            <MoneyTile
              label="Overdue Amount"
              value={summary.overdueAmount}
              sub="past credit term"
              isDark={isDark}
              emphasis={summary.overdueAmount > 0}
            />
          </div>

          <p className={`mt-3 text-xs ${muted}`}>
            Outstanding is the open pending-bill balance. Sale balances
            {summary.salesOutstanding > 0 ? ` (৳${summary.salesOutstanding.toLocaleString("en-US")}) are tracked separately` : " are shown in Total Sales only"}
            {" "}and are not added to it.
          </p>
        </div>
      ) : null}

      <div
        className={`mt-6 flex flex-wrap items-center justify-end gap-3 border-t pt-5 ${border}`}
      >
        {isEdit ? (
          <p className={`w-full text-xs sm:mr-auto sm:w-auto ${muted}`}>
            Approval status and entry details are not editable here — an admin approves from
            the customer list.
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white shadow-md shadow-indigo-500/20 transition-all hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{isEdit ? "Saving..." : "Saving Profile..."}</span>
            </>
          ) : (
            <span>{isEdit ? "Save Changes" : "Add Customer"}</span>
          )}
        </button>
      </div>
    </form>
  );
}