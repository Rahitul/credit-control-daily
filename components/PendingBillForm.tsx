"use client";

import React from "react";
import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import {
  ArrowRight,
  Calendar,
  CalendarClock,
  FileClock,
  Hash,
  Hourglass,
  Info,
  Landmark,
  Loader2,
  NotebookPen,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  createPendingBill,
  updatePendingBill,
} from "@/app/actions/pendingBills";
import { useTheme } from "@/components/ThemeProvider";
import { ROLE_HOMES } from "@/lib/nav";
import { ROLE_LABELS, type ActionResult, type Role } from "@/lib/types";
import { formatDate, toDateInput } from "@/lib/format";
import {
  deriveFromReference,
  parseReferenceNo,
  resolveDepartmentsAuto,
  routeLabel,
} from "@/lib/pendingBills";
import { PartyBillPicker } from "@/components/PartyBillPicker";
import { DepartmentSelector } from "@/components/DepartmentSelector";

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
  helperText?: string;
  children: React.ReactNode;
  className?: string;
};

const FormField = ({
  label,
  required,
  icon: Icon,
  helperText,
  children,
  className = "",
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
    </div>
  );
};

export type PendingBillValues = {
  billDate: string;
  referenceNo: string;
  partyName: string;
  openingAmount: number;
  pendingAmount: number;
  dueOn: string;
  overdueDays: number;
  note: string;
};

export function PendingBillForm({
  mode,
  home,
  bill,
  partySuggestions = [],
}: {
  mode: "create" | "edit";
  home: string;
  bill?: PendingBillValues & { id: string };
  partySuggestions?: string[];
}) {
  const { theme } = useTheme();
  const [state, formAction, pending] = useActionState<ActionResult | undefined, FormData>(
    mode === "edit" ? updatePendingBill : createPendingBill,
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

  const isEdit = mode === "edit";

  // Ref. No. and Date are controlled so the hint below Ref. No. can react as the
  // user types. It runs the SAME pure parser the server action uses, so what is
  // previewed here is exactly what will be derived and stored.
  const [referenceNo, setReferenceNo] = useState(bill?.referenceNo ?? "");
  const [billDate, setBillDate] = useState(bill?.billDate ?? "");
  // Controlled so the party picker can react to it. It was a datalist-bound
  // uncontrolled input; the datlist is kept so any party can still be typed.
  const [partyName, setPartyName] = useState(bill?.partyName ?? "");
  // Department selection state (manual override)
  const [manualDepartments, setManualDepartments] = useState<Role[]>([]);
  const [isManualOverride, setIsManualOverride] = useState(false);

  const hints = useMemo(() => {
    const value = referenceNo.trim();
    if (!value) return null;

    const parsed = parseReferenceNo(value);
    const derived = deriveFromReference(value);
    const out: { ok: boolean; text: string }[] = [];

    if (parsed.billNumber) out.push({ ok: true, text: `Bill number ${parsed.billNumber}` });
    if (parsed.issue) {
      out.push({ ok: false, text: parsed.issue });
    } else if (parsed.embeddedDate) {
      const same = !billDate || toDateInput(parsed.embeddedDate) === billDate;
      out.push({
        ok: same,
        text: same
          ? `Date ${formatDate(parsed.embeddedDate)}`
          : `Ref. date ${formatDate(parsed.embeddedDate)} ≠ bill date ${billDate || "(not set)"}`,
      });
    }

    out.push(
      derived.departments.length
        ? { ok: true, text: `Routes to ${routeLabel(derived.departments)}` }
        : { ok: false, text: "No department match — will show in Accounts only" }
    );
    return out;
  }, [referenceNo, billDate]);

  // Auto-detected departments for the selector
  const autoDepartments = useMemo(() => {
    const value = referenceNo.trim();
    if (!value) return [] as Role[];
    return resolveDepartmentsAuto(value).departments;
  }, [referenceNo]);

  const handleDepartmentChange = (departments: Role[]) => {
    setManualDepartments(departments);
    setIsManualOverride(departments.length > 0 && JSON.stringify(departments.sort()) !== JSON.stringify(autoDepartments.sort()));
  };

  // A bill can be saved into an app other than the one it was entered from
  // (`TS-…` typed in Sales routes to Consumable), so point the user at the list
  // that actually holds the row instead of silently stranding them.
  const routedRole = useMemo(() => {
    if (!state?.ok || !state.home || state.home === home) return null;
    return (Object.entries(ROLE_HOMES).find(([, h]) => h === state.home)?.[0] ?? null) as Role | null;
  }, [state, home]);

  return (
    <form
      action={formAction}
      className={`w-full rounded-2xl border p-6 shadow-xl transition-colors duration-200 sm:p-8 lg:p-10 ${surface}`}
    >
      {isEdit ? <input type="hidden" name="id" value={bill?.id ?? ""} /> : null}

      {state?.ok ? (
        <div
          className={`mb-6 flex items-start gap-3 rounded-xl border p-3.5 text-sm ${
            isDark
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          <Landmark className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
          <div className="flex-1">
            <h4
              className={`text-sm font-semibold ${
                isDark ? "text-emerald-100" : "text-emerald-900"
              }`}
            >
              {isEdit ? "Bill Updated" : "Bill Saved"}
            </h4>
            <p
              className={`mt-0.5 text-xs leading-relaxed ${
                isDark ? "text-emerald-300" : "text-emerald-700"
              }`}
            >
              {isEdit
                ? "Changes are saved. Update the Overdue by days figure if the bill has aged further."
                : "Added to the Pending Bills register. Set the Overdue by days figure as the bill ages."}
            </p>
            {routedRole ? (
              <p
                className={`mt-1.5 text-xs leading-relaxed ${
                  isDark ? "text-emerald-300" : "text-emerald-700"
                }`}
              >
                This bill belongs to{" "}
                <Link
                  href={`${ROLE_HOMES[routedRole]}/pending-bills`}
                  className="inline-flex items-center gap-1 font-semibold underline underline-offset-2"
                >
                  {ROLE_LABELS[routedRole]}
                  <ArrowRight className="h-3 w-3" />
                </Link>
                , so it won&apos;t appear in this app&apos;s list.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {state && !state.ok ? (
        <div
          className={`mb-6 flex items-start gap-3 rounded-xl border p-3.5 text-sm ${
            isDark
              ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
              : "border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          <NotebookPen className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" />
          <div className="flex-1">
            <h4
              className={`text-sm font-semibold ${
                isDark ? "text-rose-100" : "text-rose-900"
              }`}
            >
              {isEdit ? "Update Failed" : "Could Not Save"}
            </h4>
            <p
              className={`mt-0.5 text-xs leading-relaxed ${
                isDark ? "text-rose-300" : "text-rose-700"
              }`}
            >
              {state.error}
            </p>
          </div>
        </div>
      ) : null}

      {state?.ok && state.error ? (
        <div
          className={`mb-6 flex items-start gap-3 rounded-xl border p-3.5 text-sm ${
            isDark
              ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
              : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <p className="flex-1 text-xs leading-relaxed">{state.error}</p>
        </div>
      ) : null}

      <div className="mb-8 space-y-5">
        <div className={`flex items-center gap-2 border-b pb-2 ${borderSoft}`}>
          <FileClock className={`h-4 w-4 ${sectionIcon}`} />
          <h3
            className={`text-xs font-semibold tracking-wider uppercase ${sectionTitle}`}
          >
            Bill Identification
          </h3>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <FormField
              label="Date (Invoice / Bill Date)"
              required
              icon={Calendar}
              helperText="Col A — the date on the invoice or bill"
            >
              <input
                name="billDate"
                type="date"
                required
                value={billDate}
                onChange={(e) => setBillDate(e.target.value)}
                className={input}
              />
            </FormField>
          </div>

          <div className="flex flex-col gap-1.5">
            <FormField
              label="Ref. No."
              required
              icon={Hash}
              helperText="Col B — paste the whole reference: <bill number> dt.<day>.<month>.<year>. The bill number, its date and the app it belongs to are all read from this one box."
            >
              <input
                name="referenceNo"
                required
                value={referenceNo}
                onChange={(e) => setReferenceNo(e.target.value)}
                placeholder="e.g. TS-1854 dt.14.3.2026"
                className={input}
              />
            </FormField>
            {hints ? (
              <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
                {hints.map((h) => (
                  <li
                    key={h.text}
                    className={`text-[11px] ${
                      h.ok
                        ? muted
                        : `font-medium ${isDark ? "text-amber-400" : "text-amber-700"}`
                    }`}
                  >
                    {h.text}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-1">
            <DepartmentSelector
              value={manualDepartments}
              onChange={handleDepartmentChange}
              autoDepartments={autoDepartments}
              isManual={isManualOverride}
              className={input}
              helperText="Override the auto-detected department. This choice will be remembered for future entries with the same bill number."
            />
            <input type="hidden" name="manualDepartments" value={manualDepartments.join(",")} />
          </div>

          <div className="flex flex-col gap-1.5">
            <FormField
              label="Party's Name"
              required
              icon={Users}
              helperText="Col C — free text; pick a suggestion or type any party"
            >
              <input
                name="partyName"
                required
                list="pending-bill-parties"
                value={partyName}
                onChange={(e) => setPartyName(e.target.value)}
                placeholder="e.g. Acme Traders Ltd"
                className={input}
              />
            </FormField>
            <datalist id="pending-bill-parties">
              {partySuggestions.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
            <PartyBillPicker
              partyName={partyName}
              inputClassName={input}
              onPick={(picked) => {
                // A reference carries its own `dt.d.m.yyyy`, so the two are filled
                // as a matched pair rather than letting the user retype a date
                // that has to agree with it.
                setReferenceNo(picked.referenceNo);
                setBillDate(picked.billDate);
              }}
            />
          </div>
        </div>
      </div>

      <div className="mb-8 space-y-5">
        <div className={`flex items-center gap-2 border-b pb-2 ${borderSoft}`}>
          <Landmark className={`h-4 w-4 ${sectionIcon}`} />
          <h3
            className={`text-xs font-semibold tracking-wider uppercase ${sectionTitle}`}
          >
            Amounts
          </h3>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <FormField
            label="Opening Amount"
            required
            icon={Landmark}
            helperText="Col D — the bill amount when it was opened"
          >
            <div className="relative w-full">
              <input
                name="openingAmount"
                type="number"
                min="0"
                step="0.01"
                defaultValue={bill?.openingAmount ?? ""}
                placeholder="0.00"
                className={`${input} pl-7`}
              />
              <span
                className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium ${muted}`}
              >
                ৳
              </span>
            </div>
          </FormField>

          <FormField
            label="Pending Amount"
            required
            icon={Landmark}
            helperText="Col E — still unpaid; must not exceed the opening amount"
          >
            <div className="relative w-full">
              <input
                name="pendingAmount"
                type="number"
                min="0"
                step="0.01"
                required
                defaultValue={bill?.pendingAmount ?? ""}
                placeholder="0.00"
                className={`${input} pl-7`}
              />
              <span
                className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-medium ${muted}`}
              >
                ৳
              </span>
            </div>
          </FormField>
        </div>
      </div>

      <div className="mb-8 space-y-5">
        <div className={`flex items-center gap-2 border-b pb-2 ${borderSoft}`}>
          <CalendarClock className={`h-4 w-4 ${sectionIcon}`} />
          <h3
            className={`text-xs font-semibold tracking-wider uppercase ${sectionTitle}`}
          >
            Payment Terms
          </h3>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <FormField
            label="Due On"
            icon={CalendarClock}
            helperText="Col F — optional. Leave blank if there is no payment term"
          >
            <input
              name="dueOn"
              type="date"
              defaultValue={bill?.dueOn ?? ""}
              className={input}
            />
          </FormField>

          <FormField
            label="Overdue by days"
            icon={Hourglass}
            helperText="Col G — whole days overdue. Leave blank or 0 if not yet due"
          >
            <div className="relative w-full">
              <input
                name="overdueDays"
                type="number"
                min="0"
                step="1"
                defaultValue={bill?.overdueDays ?? ""}
                placeholder="0"
                className={`${input} pr-14`}
              />
              <span
                className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium ${muted}`}
              >
                days
              </span>
            </div>
          </FormField>

          <FormField
            label="Note"
            icon={NotebookPen}
            className="sm:col-span-2 lg:col-span-3"
            helperText="Optional context, e.g. what the bill covers"
          >
            <input
              name="note"
              defaultValue={bill?.note ?? ""}
              placeholder="Optional remarks"
              className={input}
            />
          </FormField>
        </div>
      </div>

      <div className={`flex flex-wrap items-center justify-end gap-3 border-t pt-5 ${border}`}>
        <Link href={`${home}/pending-bills`} className="btn-ghost">
          Cancel
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white shadow-md shadow-indigo-500/20 transition-all hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{isEdit ? "Saving Changes..." : "Saving Bill..."}</span>
            </>
          ) : (
            <span>{isEdit ? "Save Changes" : "Add Pending Bill"}</span>
          )}
        </button>
      </div>
    </form>
  );
}
