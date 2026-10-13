"use client";

import { useEffect, useState } from "react";
import { FileClock, Info, Loader2, Receipt } from "lucide-react";
import {
  getPartyBillSuggestions,
  type PartyBillSuggestionsResult,
} from "@/app/actions/pendingBills";
import { SearchSelect, type SearchOption } from "@/components/SearchSelect";
import { formatBDT } from "@/lib/format";
import { useTheme } from "@/components/ThemeProvider";

/** Picked bill, handed back to the form so it can fill Date + Ref. No. together. */
export type PickedBill = {
  referenceNo: string;
  billDate: string;
  openingAmount: number;
  pendingAmount: number;
};

/**
 * Searchable list of the bills a party already has in the register.
 *
 * Picking a row fills **both** Bill Date and Ref. No. in one go, because the
 * reference carries its own `dt.d.m.yyyy` — entering a known bill means copying
 * a matched pair, not retyping a date that has to agree with it. Bill Date stays
 * a native date picker; this is a shortcut beside it, not a replacement.
 */
export function PartyBillPicker({
  partyName,
  onPick,
  inputClassName,
}: {
  partyName: string;
  onPick: (bill: PickedBill) => void;
  inputClassName: string;
}) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const name = partyName.trim();

  // Tagged with the name it was fetched for, so a slow response for a previously
  // typed party can never be shown against the current one.
  const [loaded, setLoaded] = useState<{ name: string; data: PartyBillSuggestionsResult } | null>(
    null
  );

  useEffect(() => {
    if (!name) return;
    let cancelled = false;
    // Debounce: the party field is free text, so every keystroke would otherwise
    // fire a query.
    const t = setTimeout(() => {
      void getPartyBillSuggestions(name).then((data) => {
        if (!cancelled) setLoaded({ name, data });
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [name]);

  const loading = name !== "" && loaded?.name !== name;
  const data = loaded?.name === name ? loaded.data : null;

  const options: SearchOption[] = (data?.bills ?? []).map((b) => ({
    value: b.id,
    label: b.referenceNo,
    hint: `· ${b.billDate} · open ${formatBDT(b.pendingAmount)}${
      b.overdueDays > 0 ? ` · ${b.overdueDays}d overdue` : ""
    }`,
  }));

  const muted = isDark ? "text-zinc-500" : "text-zinc-400";

  if (!name) return null;

  return (
    <div className="mt-1.5">
      <div className="mb-1.5 flex items-center gap-1.5">
        <FileClock className={`h-3.5 w-3.5 ${isDark ? "text-indigo-400" : "text-indigo-600"}`} />
        <span
          className={`text-[11px] font-medium tracking-wider uppercase ${
            isDark ? "text-zinc-400" : "text-zinc-500"
          }`}
        >
          This party&apos;s existing bills
        </span>
        {loading ? <Loader2 className={`ml-auto h-3 w-3 animate-spin ${muted}`} /> : null}
      </div>

      {data && data.total === 0 ? (
        <p className={`text-[11px] ${muted}`}>
          No bills on record for this party — the Date and Ref. No. below are new.
        </p>
      ) : (
        <SearchSelect
          // No `name` → renders no hidden input, so this submits nothing.
          options={options}
          value=""
          placeholder={
            loading
              ? "Loading this party's bills…"
              : data
                ? `Search ${data.total} existing bill${data.total === 1 ? "" : "s"}…`
                : "Search existing bills…"
          }
          emptyMessage={loading ? "Loading…" : "No existing bill matches that search"}
          className={inputClassName}
          onValueChange={(id) => {
            const bill = data?.bills.find((b) => b.id === id);
            if (bill) {
              onPick({
                referenceNo: bill.referenceNo,
                billDate: bill.billDate,
                openingAmount: bill.openingAmount,
                pendingAmount: bill.pendingAmount,
              });
            }
          }}
        />
      )}

      {data && data.total > 0 ? (
        <p className={`mt-1.5 flex items-start gap-1.5 text-[11px] ${muted}`}>
          <Info className="mt-px h-3 w-3 shrink-0" />
          <span>
            Picking a bill fills the Date and Ref. No. below.{" "}
            {data.total > options.length
              ? `Showing the ${options.length} most recent of ${data.total}.`
              : "This reference will update this bill, not create a second one."}
          </span>
        </p>
      ) : null}

      <p className={`mt-1.5 flex items-start gap-1.5 text-[11px] ${muted}`}>
        <Receipt className="mt-px h-3 w-3 shrink-0" />
        <span>
          Bill Date and Ref. No. stay editable — this is only a shortcut to bills already
          registered.
        </span>
      </p>
    </div>
  );
}
