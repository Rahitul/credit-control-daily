"use client";

import { useMemo, useState } from "react";
import { Download, Printer, Search } from "lucide-react";
import { EmptyState } from "@/components/ui";
import { formatBDT, formatDate } from "@/lib/format";
import { CUSTOMER_CATEGORIES } from "@/lib/types";

export type ReportRow = {
  id: string;
  date: string;
  isoDate?: string;
  customer: string;
  department: string;
  type: string;
  ref?: string;
  amount: number;
  entryBy?: string;
  status?: string;
};

export function ReportsClient({
  rows,
  report,
}: {
  rows: ReportRow[];
  report: "payments" | "sales" | "customers";
}) {
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [entryBy, setEntryBy] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [sort, setSort] = useState("dateDesc");

  const types = useMemo(
    () => [...new Set(rows.map((r) => r.type).filter(Boolean))].sort(),
    [rows]
  );
  const entryByList = useMemo(
    () => [...new Set(rows.map((r) => r.entryBy).filter((v): v is string => !!v))].sort(),
    [rows]
  );

  const filtered = useMemo(() => {
    const result = rows.filter((r) => {
      const matchesQ =
        !q ||
        r.customer.toLowerCase().includes(q.toLowerCase()) ||
        (r.ref ?? "").toLowerCase().includes(q.toLowerCase()) ||
        (r.entryBy ?? "").toLowerCase().includes(q.toLowerCase()) ||
        r.type.toLowerCase().includes(q.toLowerCase());
      const matchesDept = !dept || r.department === dept;
      const matchesType = !type || r.type === type;
      const matchesStatus = !status || r.status === status;
      const matchesEntry = !entryBy || (r.entryBy ?? "") === entryBy;
      const matchesFrom = !dateFrom || !r.isoDate || r.isoDate >= dateFrom;
      const matchesTo = !dateTo || !r.isoDate || r.isoDate <= dateTo;
      const min = minAmount === "" ? null : Number(minAmount);
      const max = maxAmount === "" ? null : Number(maxAmount);
      const matchesMin = min === null || Number.isNaN(min) || r.amount >= min;
      const matchesMax = max === null || Number.isNaN(max) || r.amount <= max;
      return (
        matchesQ &&
        matchesDept &&
        matchesType &&
        matchesStatus &&
        matchesEntry &&
        matchesFrom &&
        matchesTo &&
        matchesMin &&
        matchesMax
      );
    });

    const sorted = [...result];
    sorted.sort((a, b) => {
      switch (sort) {
        case "dateAsc":
          return (a.isoDate ?? a.date).localeCompare(b.isoDate ?? b.date);
        case "amountDesc":
          return b.amount - a.amount;
        case "amountAsc":
          return a.amount - b.amount;
        case "customer":
          return a.customer.localeCompare(b.customer);
        case "dept":
          return a.department.localeCompare(b.department) || a.customer.localeCompare(b.customer);
        default:
          return (b.isoDate ?? b.date).localeCompare(a.isoDate ?? a.date);
      }
    });
    return sorted;
  }, [rows, q, dept, type, status, entryBy, dateFrom, dateTo, minAmount, maxAmount, sort]);

  const total = filtered.reduce((s, r) => s + r.amount, 0);

  const clear = () => {
    setQ("");
    setDept("");
    setType("");
    setStatus("");
    setEntryBy("");
    setDateFrom("");
    setDateTo("");
    setMinAmount("");
    setMaxAmount("");
    setSort("dateDesc");
  };

  const exportCsv = () => {
    const header = ["Date", "Customer", "Department", "Type", "Reference", "Amount", "Entry By", "Status"];
    const lines = filtered.map((r) =>
      [
        r.date,
        r.customer,
        r.department,
        r.type,
        r.ref ?? "",
        String(r.amount),
        r.entryBy ?? "",
        r.status ?? "",
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",")
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${report}-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="surface-card mb-4 space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex w-full flex-col gap-1 sm:w-auto sm:flex-1">
            <span className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-theme-muted">
              <Search className="h-3 w-3" />
              Search
            </span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Customer, ref, entry by…"
              className="input-field w-full"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-theme-muted">
              Category
            </span>
            <select
              value={dept}
              onChange={(e) => setDept(e.target.value)}
              className="input-field w-40"
            >
              <option value="">All categories</option>
              {CUSTOMER_CATEGORIES.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
              <option value="Uncategorized">Uncategorized</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-theme-muted">
              Type
            </span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="input-field w-36"
            >
              <option value="">All types</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-theme-muted">
              Status
            </span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="input-field w-36"
            >
              <option value="">All</option>
              <option value="Overdue">Overdue</option>
              <option value="Within Terms">Within terms</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-theme-muted">
              From
            </span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="input-field w-40"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-theme-muted">
              To
            </span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="input-field w-40"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-theme-muted">
              Min ৳
            </span>
            <input
              type="number"
              value={minAmount}
              onChange={(e) => setMinAmount(e.target.value)}
              min="0"
              placeholder="0"
              className="input-field w-28"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-theme-muted">
              Max ৳
            </span>
            <input
              type="number"
              value={maxAmount}
              onChange={(e) => setMaxAmount(e.target.value)}
              min="0"
              placeholder="Any"
              className="input-field w-28"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-theme-muted">
              Entry by
            </span>
            <select
              value={entryBy}
              onChange={(e) => setEntryBy(e.target.value)}
              className="input-field w-36"
            >
              <option value="">Anyone</option>
              {entryByList.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-theme-muted">
              Sort
            </span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="input-field w-40"
            >
              <option value="dateDesc">Date (new)</option>
              <option value="dateAsc">Date (old)</option>
              <option value="amountDesc">Amount high</option>
              <option value="amountAsc">Amount low</option>
              <option value="customer">Customer A–Z</option>
              <option value="dept">Department</option>
            </select>
          </label>
          <button type="button" onClick={clear} className="btn-ghost">
            Clear
          </button>
          <button type="button" onClick={exportCsv} className="btn-ghost">
            <Download className="h-4 w-4" /> CSV
          </button>
          <button type="button" onClick={() => window.print()} className="btn-ghost">
            <Printer className="h-4 w-4" /> Print / PDF
          </button>
          <span className="ml-auto text-sm text-theme-muted">
            {filtered.length} rows ·{" "}
            <span className="font-medium text-theme-strong">{formatBDT(total)}</span>
          </span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState message="No records match your filters." />
      ) : (
        <div className="surface-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-dark min-w-[1000px]">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Category</th>
                  <th>Type</th>
                  <th>Reference</th>
                  <th className="text-right">Amount</th>
                  <th>Entry By</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">{formatDate(r.isoDate ?? r.date)}</td>
                    <td className="whitespace-nowrap font-medium text-zinc-100">
                      {r.customer}
                    </td>
                    <td className="whitespace-nowrap">{r.department}</td>
                    <td className="whitespace-nowrap">{r.type}</td>
                    <td className="whitespace-nowrap font-mono text-xs">{r.ref ?? "—"}</td>
                    <td className="whitespace-nowrap text-right font-medium text-zinc-100">
                      {formatBDT(r.amount)}
                    </td>
                    <td className="whitespace-nowrap">{r.entryBy ?? "—"}</td>
                    <td className="whitespace-nowrap">
                      {r.status ? (
                        <span
                          className={`pill ${r.status === "Overdue" ? "pill-red" : "pill-green"}`}
                        >
                          {r.status}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
