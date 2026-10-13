"use client";

import {
  CheckCircle2,
  FileClock,
  Info,
  Loader2,
  TrendingDown,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { PartyBillsResult } from "@/app/actions/pendingBills";
import { formatBDT } from "@/lib/format";
import { useTheme } from "@/components/ThemeProvider";

/**
 * Read-only snapshot of a party's outstanding pending bills, shown on Add Payment
 * once a customer is picked.
 *
 * This is CONTEXT for the person taking the payment — nothing here is submitted.
 * The data comes from `usePartyPendingBills`, which the form calls once and shares
 * with the bill picker, so the two can never disagree and the query runs once.
 */
export function PartyPendingBillsCard({
  data,
  loading,
}: {
  data: PartyBillsResult | null;
  loading: boolean;
}) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const card = isDark ? "bg-zinc-900/70 border-zinc-700" : "bg-white border-zinc-200";
  const title = isDark ? "text-zinc-100" : "text-zinc-900";
  const muted = isDark ? "text-zinc-400" : "text-zinc-500";

  return (
    <div className={`rounded-2xl border p-5 ${card}`}>
      <div className="mb-4 flex items-center gap-2">
        <FileClock className={`h-4 w-4 ${isDark ? "text-indigo-400" : "text-indigo-600"}`} />
        <h3 className={`text-xs font-semibold tracking-wider uppercase ${title}`}>
          Pending Bills · Party Details
        </h3>
        {loading ? <Loader2 className={`ml-auto h-3.5 w-3.5 animate-spin ${muted}`} /> : null}
      </div>

      {loading ? (
        <p className={`text-sm ${muted}`}>Loading pending bills for this party…</p>
      ) : data && data.count === 0 ? (
        <div className="flex items-start gap-3">
          {data.allSettled ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
          ) : (
            <Info className={`mt-0.5 h-4 w-4 shrink-0 ${muted}`} />
          )}
          <div>
            <p className={`text-sm ${title}`}>
              {data.allSettled ? "No outstanding pending bills" : "No pending bills on record"}
            </p>
            <p className={`mt-0.5 text-xs ${muted}`}>
              {data.allSettled
                ? "Every bill for this party is settled, so there is nothing left to collect against."
                : "This party has no entries in the Pending Bills register."}
            </p>
          </div>
        </div>
      ) : data ? (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <Stat label="Bills Outstanding" value={String(data.count)} icon={FileClock} tone={title} />
            <Stat label="Total Pending" value={formatBDT(data.totalPending)} icon={Wallet} tone={title} />
            <Stat
              label="Of Which Overdue"
              value={formatBDT(data.totalOverdue)}
              icon={TrendingDown}
              tone={data.totalOverdue > 0 ? "text-rose-400" : title}
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[660px] text-left text-xs">
              <thead>
                <tr className={muted}>
                  <th className="py-2 pr-3 font-medium">Bill Date</th>
                  <th className="py-2 pr-3 font-medium">Reference</th>
                  <th className="py-2 pr-3 font-medium">Bill No</th>
                  <th className="py-2 pr-3 text-right font-medium">Opening</th>
                  <th className="py-2 pr-3 text-right font-medium">Pending</th>
                  <th className="py-2 pr-3 text-right font-medium">Due</th>
                  <th className="py-2 text-right font-medium">Overdue</th>
                </tr>
              </thead>
              <tbody>
                {data.bills.map((b) => (
                  <tr key={b.id} className={isDark ? "border-zinc-800" : "border-zinc-100"}>
                    <td className="whitespace-nowrap py-2 pr-3">{b.billDate || "—"}</td>
                    <td className="whitespace-nowrap py-2 pr-3">{b.referenceNo}</td>
                    <td className="whitespace-nowrap py-2 pr-3">{b.billNumber || "—"}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right">
                      {formatBDT(b.openingAmount)}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right font-medium">
                      {formatBDT(b.pendingAmount)}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right">{b.dueOn || "—"}</td>
                    <td className="whitespace-nowrap py-2 text-right">
                      {b.overdueDays > 0 ? (
                        <span className="pill pill-red">{b.overdueDays} d</span>
                      ) : (
                        <span className={muted}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className={`mt-3 flex items-start gap-2 text-xs ${muted}`}>
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Reference only — none of these bills is attached to this payment. The amount is
              still applied against outstanding sales using FIFO allocation.
            </span>
          </p>
        </>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  tone: string;
}) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  return (
    <div
      className={`rounded-xl border p-3 ${
        isDark ? "border-zinc-800 bg-zinc-900/60" : "border-zinc-200 bg-zinc-50"
      }`}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-medium tracking-wider text-zinc-500 uppercase">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <p className={`mt-1 text-sm font-semibold ${tone}`}>{value}</p>
    </div>
  );
}
