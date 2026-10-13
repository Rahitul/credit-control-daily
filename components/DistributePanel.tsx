"use client";

/**
 * Bulk distribution table: tick rows, pick a sales user, submit.
 *
 * The action is invoked directly inside `useTransition` rather than through
 * `useActionState`, for the same reason `PendingBillImportButton` does — there is
 * no wrapping form to wire up, so no ref/`requestSubmit` and no
 * `react-hooks/refs` trouble. Selection is React state, so the ids are assembled
 * into a fresh `FormData` on submit and the checkboxes never carry a `name`.
 */

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Loader2, UserCheck, UserMinus } from "lucide-react";
import { assignPendingBills, assignSales } from "@/app/actions/distribute";
import { SearchSelect, type SearchOption } from "@/components/SearchSelect";
import { useTheme } from "@/components/ThemeProvider";
import { formatBDT } from "@/lib/format";
import { EmptyState } from "@/components/ui";
import type { ActionResult } from "@/lib/types";

type BillRow = {
  id: string;
  referenceNo: string;
  billNumber: string;
  partyName: string;
  billDate: string;
  pendingAmount: number;
  overdueDays: number;
  assignedTo: string;
  assigneeName: string;
};

type SaleRow = {
  id: string;
  referenceId: string;
  billNo: string;
  customerName: string;
  saleDate: string;
  amount: number;
  assignedTo: string;
  assigneeName: string;
};

export function DistributePanel({
  target,
  actionName,
  users,
  rows,
  assignedFilter,
  pendingTotal,
  pendingCount,
  emptyMessage,
}: {
  target: "bills" | "sales";
  actionName: "assignPendingBills" | "assignSales";
  users: SearchOption[];
  rows: (BillRow | SaleRow)[];
  assignedFilter: string;
  pendingTotal: number;
  pendingCount: number;
  emptyMessage: string;
}) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const input =
    "w-full rounded-lg border px-3.5 py-2.5 text-sm transition-all focus:outline-none focus:ring-2 " +
    (isDark
      ? "border-zinc-600 bg-zinc-800 text-zinc-100 placeholder-zinc-500 focus:border-indigo-400 focus:bg-zinc-700 focus:ring-indigo-500/30"
      : "border-zinc-300 bg-zinc-50 text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:bg-white focus:ring-indigo-500/20");

  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignee, setAssignee] = useState("");
  const [result, setResult] = useState<ActionResult | undefined>();

  const ids = useMemo(() => rows.map((r) => r.id), [rows]);
  const allSelected = ids.length > 0 && selected.size === ids.length;

  /**
   * Every sales user, with the current choice guaranteed to be present.
   *
   * `SearchSelect` matches the stored `value` against `options` to decide what to
   * paint in the box, so an assignee missing from the list renders as an EMPTY
   * box and the next submit silently unassigns the row. That can happen when a
   * person is deactivated or demoted after the page was rendered.
   *
   * Note this must NOT be written as `users.filter((u) => !known.has(u.value))`
   * with `known` built from `users` — every user is in `known`, so that filter
   * returns nothing and the dropdown comes up blank, which is exactly the bug
   * this replaces. The dedup test runs on `assignee`, not on the list itself.
   */
  const options = useMemo(() => {
    if (!assignee || users.some((u) => u.value === assignee)) return users;
    return [{ value: assignee, label: "Current assignee" }, ...users];
  }, [assignee, users]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit(nextAssignee: string) {
    if (selected.size === 0) {
      setResult({ ok: false, error: "Tick at least one row first." });
      return;
    }
    const formData = new FormData();
    for (const id of selected) formData.append("ids", id);
    formData.set("assigneeId", nextAssignee);

    const action = actionName === "assignPendingBills" ? assignPendingBills : assignSales;
    startTransition(async () => {
      const res = await action(undefined, formData);
      setResult(res);
      if (res.ok) {
        setSelected(new Set());
        setAssignee(nextAssignee);
      }
    });
  }

  return (
    <div>
      <div className="surface-card mb-4 flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-64 flex-1">
          <label className="mb-1 block text-xs font-medium text-zinc-400">
            Assign selected to
          </label>
          {/* Theme-aware Tailwind, NOT `.input-field`: `SearchSelect` appends `pr-9`
              to clear room for its clear/chevron buttons, and `.input-field` is
              UNLAYERED css whose `padding` beats an unlayered utility, so it would
              win and push those buttons over the text. This mirrors the `input`
              string on `CustomerForm`/`PaymentForm` for the same reason. */}
          <SearchSelect
            options={options}
            value={assignee}
            onValueChange={(value) => setAssignee(value)}
            placeholder="Search sales users…"
            emptyMessage="No sales user matches"
            className={input}
          />
          <p className="mt-1 text-xs text-zinc-500">
            {users.length === 0
              ? "No active user holds the Sales role, so there is nobody to assign to."
              : `${users.length} sales user${users.length === 1 ? "" : "s"} available: ${users
                  .map((u) => u.label)
                  .join(", ")}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => submit(assignee)}
          disabled={pending || selected.size === 0}
          className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <UserCheck className="h-4 w-4" />
          )}
          {selected.size > 0 ? `Assign ${selected.size}` : "Assign"}
        </button>
        <button
          type="button"
          onClick={() => submit("")}
          disabled={pending || selected.size === 0}
          className="btn-ghost disabled:cursor-not-allowed disabled:opacity-50"
        >
          <UserMinus className="h-4 w-4" />
          Unassign {selected.size > 0 ? selected.size : ""}
        </button>
      </div>

      {result ? (
        <div
          className={`surface-card mb-4 p-3 text-sm ${
            result.ok ? "text-emerald-300" : "text-rose-300"
          }`}
        >
          {result.ok ? (result.error ?? "Done.") : result.error}
        </div>
      ) : null}

      <p className="mb-3 text-sm text-zinc-500">
        {rows.length} shown · {pendingCount} sales-routed{" "}
        {target === "bills" ? "pending bills" : "sales"} in total worth{" "}
        <span className="font-medium text-zinc-200">{formatBDT(pendingTotal)}</span>
        {assignedFilter === "unassigned" ? (
          <>
            {" · "}
            <span className="text-amber-300">showing the unassigned queue</span>
          </>
        ) : null}
      </p>

      {rows.length === 0 ? (
        <EmptyState message={emptyMessage} />
      ) : (
        <div className="surface-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-dark min-w-[1000px]">
              <thead>
                <tr>
                  <th className="w-10">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={allSelected}
                      onChange={() =>
                        setSelected(allSelected ? new Set() : new Set(ids))
                      }
                    />
                  </th>
                  {target === "bills" ? (
                    <>
                      <th>Ref. No.</th>
                      <th>Party&apos;s Name</th>
                      <th>Bill Date</th>
                      <th className="text-right">Pending</th>
                      <th>Overdue</th>
                    </>
                  ) : (
                    <>
                      <th>Reference ID</th>
                      <th>Bill No</th>
                      <th>Customer</th>
                      <th>Date</th>
                      <th className="text-right">Amount</th>
                    </>
                  )}
                  <th>Assigned To</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const bill = r as BillRow;
                  const sale = r as SaleRow;
                  return (
                    <tr key={r.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${"referenceNo" in bill ? bill.referenceNo : sale.referenceId}`}
                          checked={selected.has(r.id)}
                          onChange={() => toggle(r.id)}
                        />
                      </td>
                      {target === "bills" ? (
                        <>
                          <td className="whitespace-nowrap font-mono text-xs text-indigo-300">
                            {bill.referenceNo}
                          </td>
                          <td className="whitespace-nowrap font-medium text-zinc-100">
                            {bill.partyName}
                          </td>
                          <td className="whitespace-nowrap">{bill.billDate}</td>
                          <td className="whitespace-nowrap text-right font-medium text-amber-300">
                            {formatBDT(bill.pendingAmount)}
                          </td>
                          <td className="whitespace-nowrap">
                            {bill.overdueDays > 0 ? (
                              <span className="pill pill-red">{bill.overdueDays}d</span>
                            ) : (
                              <span className="text-zinc-500">—</span>
                            )}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="whitespace-nowrap font-mono text-xs text-indigo-300">
                            {sale.referenceId}
                          </td>
                          <td className="whitespace-nowrap font-mono text-xs text-zinc-300">
                            {sale.billNo || "—"}
                          </td>
                          <td className="whitespace-nowrap font-medium text-zinc-100">
                            {sale.customerName}
                          </td>
                          <td className="whitespace-nowrap">{sale.saleDate}</td>
                          <td className="whitespace-nowrap text-right font-medium text-zinc-100">
                            {formatBDT(sale.amount)}
                          </td>
                        </>
                      )}
                      <td className="whitespace-nowrap">
                        {r.assignedTo && r.assigneeName ? (
                          <span className="text-xs text-zinc-200">{r.assigneeName}</span>
                        ) : (
                          <span className="pill pill-amber">Unassigned</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="mt-3 text-xs text-zinc-500">
        Tick rows above and pick a person. A sales user sees only the rows assigned
        to them — everything left unassigned stays invisible to the sales app
        until it is handed out.{" "}
        <Link href="/accounts/pending-bills?route=sales" className="underline">
          Open the sales-routed register
        </Link>
        .
      </p>
    </div>
  );
}
