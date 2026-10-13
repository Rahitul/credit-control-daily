"use client";

import { useState, useActionState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { addFollowUp } from "@/app/actions/pendingBills";
import { ErrorBanner, SuccessBanner } from "@/components/form";
import { PendingBillRowActions } from "@/components/PendingBillRowActions";
import { formatBDT, formatDate } from "@/lib/format";
import type { PendingBillRow } from "@/lib/pendingBillsData";
import { ROLE_LABELS, type ActionResult, type Role } from "@/lib/types";
import { Modal } from "@/components/Modal";

/**
 * One Pending Bills row, plus the full-width follow-up panel it expands into.
 *
 * This is a Client Component and renders the ROW PAIR, not just a cell: the
 * panel is a sibling `<tr>`, so a `<tr>` can never end up nested inside another
 * `<tr>`, and React's table-content model stays valid. `PendingBillsView` stays
 * a Server Component and simply maps rows to this.
 */
export function PendingBillTableRow({
  bill: b,
  completed,
  department,
  home,
  showAssignee,
}: {
  bill: PendingBillRow;
  completed: boolean;
  department: Role | null;
  home: string;
  /** Accounts/Admin see the work-allocation column; a sales user does not. */
  showAssignee: boolean;
}) {
  const [open, setOpen] = useState(false);

  // Date · Ref · Bill No · [Routed To] · Branch · Party · Credit Term · Opening ·
  // Pending/Settled · Due on/Settled on · Overdue/Settled by · [Bill Age] ·
  // [Follow-ups] · [Promised] · Entry By · [Assigned To] · actions
  //
  const deptLabel = (key: string) =>
    key && key in ROLE_LABELS ? ROLE_LABELS[key as Role] : key || "Unknown";

  return (
    <>
      <tr>
        <td className="whitespace-nowrap">{formatDate(b.billDate)}</td>
        <td className="whitespace-nowrap font-mono text-xs text-zinc-400">{b.referenceNo}</td>
        <td className="whitespace-nowrap">
          {b.billNumber ? (
            <span className="font-mono text-xs text-indigo-300">{b.billNumber}</span>
          ) : (
            <span className="text-zinc-500">—</span>
          )}
          {b.warnings.length ? (
            <span className="mt-1 flex flex-col gap-0.5">
              {b.warnings.map((w) => (
                <span
                  key={w}
                  title={w}
                  className="max-w-[16rem] truncate text-[11px] leading-tight text-amber-400"
                >
                  ⚠ {w}
                </span>
              ))}
            </span>
          ) : null}
        </td>
        {department ? null : (
          <td className="whitespace-nowrap">
            {b.departments.length ? (
              <span className="flex flex-wrap gap-1">
                {b.departments.map((d) => (
                  <span key={d} className="pill pill-indigo">
                    {ROLE_LABELS[d]}
                  </span>
                ))}
              </span>
            ) : (
              <span className="pill pill-amber">Accounts only</span>
            )}
          </td>
        )}
        {/* The branch office, as the WRITE-TIME snapshot of `Branch.name`. A row
            written before branch routing existed renders "—"; the "Routed To"
            column above is the department and is a different question. */}
        <td className="whitespace-nowrap">
          {b.branchName ? (
            <span className="pill pill-indigo">{b.branchName}</span>
          ) : (
            <span className="text-zinc-500">—</span>
          )}
        </td>
        <td className="whitespace-nowrap font-medium text-zinc-100">{b.partyName}</td>
        {/* Credit TERM in days: the PARTY's stored term when the customer
            record has one (stored Credit Limit (Days) > 0 → Min/Max override
            > 0), else THIS bill's own `billDate → dueOn` gap — both computed
            in the data layer. Deliberately NO party-derived range here: each
            bill shows its individual term unless the customer pinned one.
            `—` means neither exists: no party term AND no due date on the
            bill. `0` is a real term (due the same day it was billed) and must
            not read as "missing", so it is compared against null rather than
            falsiness. */}
        <td className="whitespace-nowrap text-zinc-300">
          {b.partyTerm ? (
            <span
              title={
                b.partyTerm.min === b.partyTerm.max
                  ? `Credit term: ${b.partyTerm.min} day(s) — from the customer record`
                  : `Credit term: ${b.partyTerm.min}–${b.partyTerm.max} days — from the customer record`
              }
            >
              {b.partyTerm.min === b.partyTerm.max
                ? `${b.partyTerm.min} day${b.partyTerm.min === 1 ? "" : "s"}`
                : `${b.partyTerm.min}–${b.partyTerm.max} days`}
            </span>
          ) : b.creditLimitDays === null ? (
            <span
              className="text-zinc-500"
              title="No due date set on this bill, so it has no credit term"
            >
              —
            </span>
          ) : (
            <span title={`Credit term: ${b.creditLimitDays} day(s) from the bill date to the due date`}>
              {b.creditLimitDays} day{b.creditLimitDays === 1 ? "" : "s"}
            </span>
          )}
        </td>
        <td className="whitespace-nowrap text-right text-zinc-300">
          {formatBDT(b.openingAmount)}
        </td>
        {completed ? (
          <td className="whitespace-nowrap text-right font-medium text-emerald-300">
            {b.settledAmount > 0 ? (
              formatBDT(b.settledAmount)
            ) : (
              /* A bill can reach zero by being written down rather than paid, so
                 there may be no settlement behind it. */
              <span className="text-zinc-500" title="No approved payment found against this bill">
                {formatBDT(b.openingAmount)} written off
              </span>
            )}
          </td>
        ) : (
          <td className="whitespace-nowrap text-right font-medium text-amber-300">
            {formatBDT(b.pendingAmount)}
          </td>
        )}
        {completed ? (
          <>
            <td className="whitespace-nowrap">
              {b.settledOn ? formatDate(b.settledOn) : "—"}
            </td>
            <td className="whitespace-nowrap text-xs text-zinc-400">
              {b.settledBy || <span className="text-zinc-500">—</span>}
            </td>
          </>
        ) : (
          <>
            <td className="whitespace-nowrap">{b.dueOn ? formatDate(b.dueOn) : "—"}</td>
            <td className="whitespace-nowrap">
              {b.overdueDays > 0 ? (
                <span className="pill pill-red">{b.overdueDays}d overdue</span>
              ) : (
                <span className="text-zinc-500">—</span>
              )}
            </td>
            <td className="whitespace-nowrap" title={`Entered ${formatDate(b.billDate)}`}>
              {b.daysSinceBill === 0 ? (
                <span className="text-zinc-500">today</span>
              ) : (
                <span className={b.daysSinceBill < 0 ? "text-amber-400" : "text-zinc-300"}>
                  {b.daysSinceBill}d
                </span>
              )}
            </td>
          </>
        )}
        {!completed ? (
          <>
            <FollowUpToggle bill={b} open={open} onToggle={() => setOpen(!open)} />
            <PromisedCell bill={b} />
          </>
        ) : null}
        <td className="whitespace-nowrap">
          {b.creatorName || b.entryBy ? (
            <>
              {b.creatorRole ? (
                <span className={`pill ${b.creatorName ? "pill-indigo" : "pill-zinc"}`}>
                  {deptLabel(b.creatorRole)}
                </span>
              ) : null}
              <span className="block text-xs text-zinc-500">{b.creatorName || b.entryBy}</span>
            </>
          ) : (
            <span className="text-zinc-500">—</span>
          )}
        </td>
        {showAssignee ? (
          <td className="whitespace-nowrap">
            {b.assigneeName ? (
              <span className="text-xs text-zinc-200">{b.assigneeName}</span>
            ) : (
              // An unassigned row is work nobody owns yet. Flagged rather than
              // blank so "N unassigned" in the header is traceable to actual rows.
              <span className="pill pill-amber">Unassigned</span>
            )}
          </td>
        ) : null}
        <td>
          <PendingBillRowActions id={b.id} referenceNo={b.referenceNo} home={home} />
        </td>
      </tr>
      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title={`Follow-Ups - ${b.billNumber || b.referenceNo} | ${b.partyName}`}
        size="lg"
      >
        <FollowUpPanel bill={b} />
      </Modal>
    </>
  );
}

function FollowUpToggle({
  bill,
  open,
  onToggle,
}: {
  bill: PendingBillRow;
  open: boolean;
  onToggle: () => void;
}) {
  const count = bill.followUpCount;
  const last = bill.lastFollowUpDate ? formatDate(bill.lastFollowUpDate) : null;

  return (
    <td className="whitespace-nowrap">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        title={
          count > 0
            ? `${count} follow-up${count === 1 ? "" : "s"} · last ${last}`
            : "No follow-ups yet — add one"
        }
        className={`flex cursor-pointer items-center gap-1.5 text-xs transition ${
          count > 0 ? "text-emerald-300 hover:text-emerald-200" : "text-zinc-500 hover:text-zinc-300"
        }`}
      >
        <MessageSquarePlus className="h-3.5 w-3.5" />
        {count > 0 ? (
          <span className="pill pill-emerald">
            {count} · {last}
          </span>
        ) : (
          <span>Add</span>
        )}
      </button>
    </td>
  );
}

/**
 * The live promise, with the one distinction that drives a follow-up call: has
 * the date the customer gave already gone by? `promisedPassed` arrives
 * pre-computed from the data layer — see the hydration note there.
 */
function PromisedCell({ bill }: { bill: PendingBillRow }) {
  if (!bill.lastPromisedDate) {
    return (
      <td className="whitespace-nowrap">
        <span className="text-zinc-500" title="No follow-up has recorded a promised date">
          —
        </span>
      </td>
    );
  }

  return (
    <td className="whitespace-nowrap">
      <span
        className={`pill ${bill.promisedPassed ? "pill-red" : "pill-green"}`}
        title={
          bill.promisedPassed
            ? `Promised for ${formatDate(bill.lastPromisedDate)} — the date has passed and the bill is still unpaid`
            : `Promised for ${formatDate(bill.lastPromisedDate)}`
        }
      >
        {formatDate(bill.lastPromisedDate)}
        {bill.promisedPassed ? " · passed" : ""}
      </span>
    </td>
  );
}

type FollowUpResult = ActionResult & { count?: number };

function FollowUpPanel({ bill }: { bill: PendingBillRow }) {
  const [state, formAction, pending] = useActionState<FollowUpResult | undefined, FormData>(
    addFollowUp,
    undefined
  );

  // Stored oldest-first so the sequence number is the array position; the panel
  // shows the newest call first.
  const history = [...bill.followUps].reverse();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Follow-Up History ({bill.followUpCount})
        </h4>
        <p className="text-xs text-zinc-500">{bill.partyName}</p>
      </div>

      {history.length === 0 ? (
        <p className="text-xs text-zinc-500">
          No follow-ups yet. Add the first note after your next call.
        </p>
      ) : (
        <ul className="space-y-2">
          {history.map((f, i) => (
            <li key={`${f.date}-${i}`} className="rounded-lg border border-theme p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                <span className="font-medium text-zinc-300">
                  #{bill.followUpCount - i}
                </span>
                <span>{formatDate(f.date)}</span>
                {f.creatorName ? (
                  <span className="pill pill-indigo">{f.creatorName}</span>
                ) : null}
                {f.createdByRole ? (
                  <span className="pill pill-zinc">{deptLabelFor(f.createdByRole)}</span>
                ) : null}
                {f.estimatedPaymentDate ? (
                  <span className="pill pill-indigo">
                    promised {formatDate(f.estimatedPaymentDate)}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-200">{f.note}</p>
            </li>
          ))}
        </ul>
      )}

      <form action={formAction} className="space-y-2">
        <input type="hidden" name="id" value={bill.id} />
        <textarea
          name="note"
          required
          maxLength={500}
          rows={2}
          placeholder="What did the customer say? e.g. Promised to pay by Friday"
          className="input-field w-full resize-none"
        />
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-400">
              Estimated payment date
            </span>
            <input
              type="date"
              name="estimatedPaymentDate"
              className="input-field w-44"
            />
          </label>
          <span className="pb-2 text-xs text-zinc-500">
            Optional — only if they committed to a date. The latest one becomes
            the promise shown in the list.
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-zinc-500">Max 500 characters</span>
          <button type="submit" disabled={pending} className="btn-primary px-4 py-2 text-xs">
            {pending ? "Adding…" : `Add Follow-Up #${bill.followUpCount + 1}`}
          </button>
        </div>
        {state && !state.ok ? <ErrorBanner message={state.error} /> : null}
        {state && state.ok ? (
          <SuccessBanner message={`Follow-up #${state.count ?? bill.followUpCount + 1} recorded.`} />
        ) : null}
      </form>
    </div>
  );
}

function deptLabelFor(key: string) {
  return key && key in ROLE_LABELS ? ROLE_LABELS[key as Role] : key;
}
