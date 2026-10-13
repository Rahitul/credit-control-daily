"use client";

import { useActionState, useMemo, useState } from "react";
import {
  Users,
  Calendar,
  Banknote,
  Landmark,
  Receipt,
  Hash,
  UserCheck,
  Link2,
  AlertCircle,
  CheckCircle2,
  Info,
  Loader2,
  Wallet,
  Percent,
  type LucideIcon,
} from "lucide-react";
import { createPayment } from "@/app/actions/payments";
import { SearchSelect } from "@/components/SearchSelect";
import { PartyPendingBillsCard } from "@/components/PartyPendingBillsCard";
import { PartyBillsPicker, type PickedPartyBill } from "@/components/PartyBillsPicker";
import { usePartyPendingBills } from "@/components/usePartyPendingBills";
import { useTheme } from "@/components/ThemeProvider";
import { toDateInput } from "@/lib/format";
import { BANK_TYPES, PAYMENT_TYPES, type ActionResult } from "@/lib/types";

type Option = {
  id: string;
  name: string;
  branch?: string;
};

/** Sale a payment can be linked to; bill fields are copied from it on selection */
type SaleOption = {
  referenceId: string;
  customerId: string;
  billNo: string;
  billDate: string;
};

const FormField = ({
  label,
  required,
  icon: Icon,
  children,
  className = "",
}: {
  label: string;
  required?: boolean;
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
}) => {
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
      </label>
      <div className="relative flex items-center">{children}</div>
    </div>
  );
};

export function PaymentForm({
  customers,
  sales,
  defaultPerson,
  billCategories = [],
  paymentTypes = [],
  bankTypes = [],
  bankNames = [],
  branches = [],
}: {
  customers: Option[];
  sales: SaleOption[];
  defaultPerson?: string;
  billCategories?: string[];
  paymentTypes?: string[];
  bankTypes?: string[];
  bankNames?: string[];
  branches?: string[];
}) {
  const { theme } = useTheme();
  const [state, formAction, pending] = useActionState<ActionResult | undefined, FormData>(
    createPayment,
    undefined
  );
  const [selected, setSelected] = useState("");
  const [billNo, setBillNo] = useState("");
  const [billDate, setBillDate] = useState("");
  const [relatedRef, setRelatedRef] = useState("");
  /**
   * The reference of a bill chosen from the pending-bill picker.
   *
   * `relatedRef` is the value of a controlled `<select>`, and a controlled select
   * whose value matches no option both displays blank AND submits empty. Putting a
   * pending bill's reference there therefore needs the matching `<option>` to
   * exist, which is what this is tracked for.
   */
  const [pickedBillRef, setPickedBillRef] = useState("");
  const [branch, setBranch] = useState("");
  const [amount, setAmount] = useState("");
  const today = useMemo(() => toDateInput(new Date()), []);

  // One fetch for the selected customer, shared by the bill picker and the
  // read-only summary card below.
  const partyBills = usePartyPendingBills(selected);

  const billCategoryOptions = billCategories.length ? billCategories : [];
  const paymentTypeOptions = paymentTypes.length ? paymentTypes : [...PAYMENT_TYPES];
  const bankTypeOptions = bankTypes.length ? bankTypes : [...BANK_TYPES];
  const bankNameOptions = bankNames;

  // Every customer, searchable. Kept in its own memo so typing in the box does
  // not rebuild the option list on each keystroke.
  const customerOptions = useMemo(
    () => customers.map((c) => ({ value: c.id, label: c.name, hint: c.branch })),
    [customers]
  );

  // The auto-filled branch is merged in, so a customer whose branch is missing
  // from Manage Dropdowns still shows its stored value instead of an empty box.
  const branchOptions = useMemo(() => {
    const all = new Set(branches);
    const current = branch.trim();
    if (current) all.add(current);
    return [...all].sort().map((b) => ({ value: b, label: b }));
  }, [branches, branch]);

  /** Copy a customer's branch + their oldest (FIFO-first) bill into the form */
  const selectCustomer = (id: string) => {
    setSelected(id);
    const cust = customers.find((c) => c.id === id);
    // `branch` is React state, NOT a getElementsByName write: the searchable
    // control's visible box is only the search input, so writing to it (or to the
    // hidden field) would move the submitted value without updating the display.
    setBranch(cust?.branch ?? "");
    const first = sales.find((s) => s.customerId === id);
    setRelatedRef(first?.referenceId ?? "");
    // A reference from the previous customer's pending bill must not follow the
    // new customer, and the auto-filled bill fields are refreshed below anyway.
    setPickedBillRef("");
    setBillNo(first?.billNo ?? "");
    setBillDate(first?.billDate ?? "");
  };

  /**
   * Fill the form from a pending bill the user chose from the searchable list.
   *
   * `rcvAmount` is React state, not a `getElementsByName` write: it is a real
   * visible input, but keeping it controlled means the pending amount can be
   * suggested without racing the user's own typing. It is only suggested when the
   * box is still empty, so a typed amount is never overwritten.
   *
   * Reference No takes the bill's own reference, so the payment is filed against
   * the exact document it settles.
   */
  const applyPartyBill = (bill: PickedPartyBill) => {
    setBillNo(bill.billNumber || bill.referenceNo);
    setBillDate(bill.billDate);
    setAmount((current) => (current.trim() ? current : String(bill.pendingAmount)));
    const ref = bill.referenceNo || bill.billNumber;
    setPickedBillRef(ref);
    setRelatedRef(ref);
  };

  const isDark = theme === "dark";

  const surface = isDark
    ? "bg-zinc-900 border-zinc-700 shadow-black/30"
    : "bg-white border-zinc-200 shadow-zinc-200/60";
  const muted = isDark ? "text-zinc-400" : "text-zinc-500";
  const sectionTitle = isDark ? "text-zinc-400" : "text-zinc-500";
  const sectionIcon = isDark ? "text-zinc-500" : "text-zinc-400";
  const border = isDark ? "border-zinc-700" : "border-zinc-200";
  const borderSoft = isDark ? "border-zinc-700/80" : "border-zinc-200/80";
  const accent = isDark ? "text-indigo-400" : "text-indigo-600";
  const input =
    "w-full rounded-lg border px-3.5 py-2.5 text-sm transition-all focus:outline-none focus:ring-2 " +
    (isDark
      ? "border-zinc-600 bg-zinc-800 text-zinc-100 placeholder-zinc-500 focus:border-indigo-400 focus:bg-zinc-700 focus:ring-indigo-500/30"
      : "border-zinc-300 bg-zinc-50 text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:bg-white focus:ring-indigo-500/20");

  const showSuccess = state?.ok && !state.error;
  const showWarning = state?.ok && !!state.error;
  const showError = state && !state.ok;

  return (
    <form
      action={formAction}
      className={`w-full rounded-2xl border p-6 shadow-xl transition-colors duration-200 sm:p-8 lg:p-10 ${surface}`}
    >
      <div className={`mb-8 border-b pb-5 ${border}`}>
        <div className={`mb-1 flex items-center gap-2 text-xs font-semibold tracking-wider uppercase ${accent}`}>
          <Wallet className="h-4 w-4" />
          <span>Payment Collection</span>
        </div>
        <h2 className={`text-2xl font-bold tracking-tight ${isDark ? "text-zinc-50" : "text-zinc-900"}`}>
          Record Payment
        </h2>
        <p className={`mt-1 text-xs sm:text-sm ${muted}`}>
          Applies against outstanding sales using FIFO allocation.
        </p>
      </div>

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
              Payment entry submitted.
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
              Payment Saved
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
          <Users className={`h-4 w-4 ${sectionIcon}`} />
          <h3 className={`text-xs font-semibold tracking-wider uppercase ${sectionTitle}`}>
            Collection Details
          </h3>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <FormField label="Rcv Date" required icon={Calendar}>
            <input
              name="rcvDate"
              type="date"
              required
              defaultValue={today}
              className={input}
            />
          </FormField>

          <FormField
            label="Customer Name"
            required
            icon={Users}
            className="sm:col-span-2 lg:col-span-2"
          >
            <SearchSelect
              name="customerId"
              required
              className={input}
              options={customerOptions}
              value={selected}
              placeholder="Search customer name..."
              emptyMessage="No customer matches that search"
              onValueChange={selectCustomer}
            />
          </FormField>

          <FormField label="Branch" icon={Landmark}>
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

          <FormField label="Bill Category" icon={Receipt}>
            <select name="billCategory" className={input} defaultValue="">
              <option value="">Select category</option>
              {billCategoryOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Bill No" icon={Hash}>
            <input
              name="billNo"
              className={input}
              placeholder="Bill number"
              value={billNo}
              onChange={(e) => setBillNo(e.target.value)}
            />
          </FormField>

          <FormField label="Bill Date" icon={Calendar}>
            <input
              name="billDate"
              type="date"
              className={input}
              value={billDate}
              onChange={(e) => setBillDate(e.target.value)}
            />
          </FormField>

          {/* Spans the full row so the bill list sits directly under Bill No /
              Bill Date, the two fields it fills in. */}
          <div className="sm:col-span-2 lg:col-span-3">
            {selected ? (
              <PartyBillsPicker
                data={partyBills.data}
                loading={partyBills.loading}
                onPick={applyPartyBill}
                inputClassName={input}
              />
            ) : (
              <p className={`flex items-center gap-1.5 text-[11px] ${muted}`}>
                <Receipt className="h-3 w-3 shrink-0" />
                Pick a customer to choose from their outstanding bills — it fills
                Bill No and Bill Date.
              </p>
            )}
          </div>

          <FormField label="Payment Type" required icon={Wallet}>
            <select name="paymentType" required className={input} defaultValue="">
              <option value="" disabled>
                Select type
              </option>
              {paymentTypeOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Discounted Payment" icon={Percent}>
            <label
              className={`flex cursor-pointer items-center gap-2 text-sm ${
                isDark ? "text-zinc-300" : "text-zinc-700"
              }`}
            >
              <input
                type="checkbox"
                name="isDiscounted"
                className="h-4 w-4 rounded accent-indigo-600"
              />
              <span>Discounted payment</span>
            </label>
          </FormField>

          <FormField label="Vat" icon={Percent}>
            <label
              className={`flex cursor-pointer items-center gap-2 text-sm ${
                isDark ? "text-zinc-300" : "text-zinc-700"
              }`}
            >
              <input
                type="checkbox"
                name="isVat"
                className="h-4 w-4 rounded accent-indigo-600"
              />
              <span>Vat applied</span>
            </label>
          </FormField>

          <FormField label="Tax/AIT" icon={Percent}>
            <label
              className={`flex cursor-pointer items-center gap-2 text-sm ${
                isDark ? "text-zinc-300" : "text-zinc-700"
              }`}
            >
              <input
                type="checkbox"
                name="isTaxAit"
                className="h-4 w-4 rounded accent-indigo-600"
              />
              <span>Tax/AIT applied</span>
            </label>
          </FormField>

          <FormField label="Rcv Amount (৳)" required icon={Banknote}>
            <div className="relative w-full">
              <input
                name="rcvAmount"
                type="number"
                min="0.01"
                step="0.01"
                required
                className={`${input} pr-12`}
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <span
                className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium ${muted}`}
              >
                BDT
              </span>
            </div>
          </FormField>

          <FormField label="Bank Type" icon={Landmark}>
            <select name="bankType" className={input} defaultValue="">
              <option value="">Select bank (optional)</option>
              {bankTypeOptions.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Bank Name / Branch" icon={Landmark}>
            <select name="bankName" className={input} defaultValue="">
              <option value="">Select bank name (optional)</option>
              {bankNameOptions.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Assigned Person" icon={UserCheck}>
            <input
              name="assignedPerson"
              className={input}
              defaultValue={defaultPerson ?? ""}
              placeholder="Assigned person"
            />
          </FormField>

          <FormField label="Reference No" icon={Link2}>
            {/*
              Read-only, and deliberately not a <select>. The value is filled for
              you — from the bill picked above, or from the customer's oldest sale
              when a customer is chosen — so there is nothing to choose from, and a
              controlled <select> holding a value with no matching option would
              display blank *and* submit empty. A read-only input shows the
              reference and submits it verbatim.
            */}
            <input
              name="relatedSaleReferenceId"
              className={`${input} cursor-not-allowed opacity-70`}
              placeholder="Reference no"
              value={relatedRef}
              readOnly
            />
            <p className={`mt-1.5 flex items-start gap-1.5 text-[11px] ${muted}`}>
              <Info className="mt-px h-3 w-3 shrink-0" />
              <span>
                {pickedBillRef
                  ? "From the pending bill you picked above."
                  : relatedRef
                    ? "From this customer's oldest sale."
                    : "Pick a bill above, or a customer with a sale, to fill this in."}
              </span>
            </p>
          </FormField>

          <FormField label="Entry By" icon={UserCheck}>
            <input
              className={`${input} cursor-not-allowed opacity-70`}
              value={defaultPerson ?? ""}
              readOnly
              disabled
            />
            <input type="hidden" name="entryBy" value={defaultPerson ?? ""} />
          </FormField>
        </div>

        {/* The party's outstanding bills, fetched only once a customer is picked. */}
        {selected ? (
          <PartyPendingBillsCard data={partyBills.data} loading={partyBills.loading} />
        ) : null}
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
              <span>Submitting...</span>
            </>
          ) : (
            <span>Submit Entry</span>
          )}
        </button>
      </div>
    </form>
  );
}
