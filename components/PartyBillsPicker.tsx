"use client";

import { FileClock, Loader2, Receipt, Search } from "lucide-react";
import type { PartyBillsResult } from "@/app/actions/pendingBills";
import { SearchSelect, type SearchOption } from "@/components/SearchSelect";
import { formatBDT } from "@/lib/format";
import { useTheme } from "@/components/ThemeProvider";

/** A bill the user chose to collect against. */
export type PickedPartyBill = {
  billNumber: string;
  referenceNo: string;
  billDate: string;
  pendingAmount: number;
};

/**
 * Searchable list of the outstanding pending bills for the customer picked on the
 * payment form, so the person taking the payment can say WHICH bill this money
 * is for instead of retyping a bill number.
 *
 * Picking a row fills Bill No, Bill Date and — only when the amount box is still
 * empty — the pending amount, because that is nearly always what is being
 * collected. It does **not** set `relatedSaleReferenceId`: a pending bill is not a
 * Sale, so the payment's FIFO allocation across sales is untouched.
 *
 * Only outstanding bills are listed (`pendingAmount > 0`); a settled bill has
 * nothing left to collect.
 */
export function PartyBillsPicker({
  data,
  loading,
  onPick,
  inputClassName,
}: {
  data: PartyBillsResult | null;
  loading: boolean;
  onPick: (bill: PickedPartyBill) => void;
  inputClassName: string;
}) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const muted = isDark ? "text-zinc-500" : "text-zinc-400";

  const bills = data?.bills ?? [];

  const options: SearchOption[] = bills.map((b) => ({
    // `billNumber` is the short id (e.g. `TS-1854`); fall back to the full
    // reference for a bill written before the number was persisted.
    value: b.id,
    label: b.billNumber || b.referenceNo,
    hint: `· ${b.billDate} · open ${formatBDT(b.pendingAmount)}${
      b.overdueDays > 0 ? ` · ${b.overdueDays}d overdue` : ""
    }`,
  }));

  return (
    <div className="mt-1.5">
      <div className="mb-1.5 flex items-center gap-1.5">
        <FileClock className={`h-3.5 w-3.5 ${isDark ? "text-indigo-400" : "text-indigo-600"}`} />
        <span
          className={`text-[11px] font-medium tracking-wider uppercase ${
            isDark ? "text-zinc-400" : "text-zinc-500"
          }`}
        >
          Select the bill being paid
        </span>
        {loading ? <Loader2 className={`ml-auto h-3 w-3 animate-spin ${muted}`} /> : null}
      </div>

      <SearchSelect
        // No `name` → renders no hidden input, so the picker itself submits
        // nothing; it only fills the real Bill No / Bill Date / amount fields.
        options={options}
        value=""
        placeholder={
          loading
            ? "Loading this customer's bills…"
            : bills.length
              ? `Search ${bills.length} outstanding bill${bills.length === 1 ? "" : "s"}…`
              : "No outstanding bills"
        }
        emptyMessage={
          loading ? "Loading…" : "No outstanding bill matches that search"
        }
        className={inputClassName}
        onValueChange={(id) => {
          const bill = bills.find((b) => b.id === id);
          if (!bill) return;
          onPick({
            billNumber: bill.billNumber,
            referenceNo: bill.referenceNo,
            billDate: bill.billDate,
            pendingAmount: bill.pendingAmount,
          });
        }}
      />

      {!loading && bills.length > 0 ? (
        <p className={`mt-1.5 flex items-start gap-1.5 text-[11px] ${muted}`}>
          <Search className="mt-px h-3 w-3 shrink-0" />
          <span>
            Picking a bill fills Bill No and Bill Date, and the pending amount if that box is
            still empty. Search by bill number or reference.
          </span>
        </p>
      ) : null}

      {!loading && data && data.count === 0 ? (
        <p className={`mt-1.5 flex items-start gap-1.5 text-[11px] ${muted}`}>
          <Receipt className="mt-px h-3 w-3 shrink-0" />
          <span>
            {data.allSettled
              ? "Every pending bill for this customer is settled — nothing outstanding to select."
              : "This customer has no entries in the Pending Bills register."}{" "}
            Bill No and Bill Date stay editable.
          </span>
        </p>
      ) : null}
    </div>
  );
}
