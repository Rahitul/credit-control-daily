"use client";

import { useActionState } from "react";
import { CheckCircle2, Loader2, RotateCw } from "lucide-react";
import { approvePayment } from "@/app/actions/payments";
import type { PaymentApprovalStatus } from "@/lib/models/Payment";
import { useTheme } from "@/components/ThemeProvider";

/**
 * Approve one payment, which is what releases its money against pending bills.
 *
 * The server action re-checks the role and the self-approval rule, so this button
 * is only a convenience — it can never grant a permission the action would refuse.
 * `allocating` is a payment left mid-approval by a crash, so the same button is
 * offered again as a retry: `allocatePayment` recomputes from live bill values and
 * its conditional update makes the already-applied part a no-op.
 */
export function PaymentApproveButton({
  paymentId,
  status,
  canApprove,
}: {
  paymentId: string;
  status: PaymentApprovalStatus | string;
  canApprove: boolean;
}) {
  const [state, formAction, pending] = useActionState(approvePayment, undefined);
  const { theme } = useTheme();
  const isDark = theme === "dark";

  if (status === "approved") {
    return <span className={`text-xs ${isDark ? "text-zinc-500" : "text-zinc-400"}`}>—</span>;
  }

  if (!canApprove) {
    return (
      <span className={`text-xs ${isDark ? "text-zinc-500" : "text-zinc-400"}`}>
        {status === "allocating" ? "In progress" : "Other approver"}
      </span>
    );
  }

  // Rendered straight from the action result — no `useEffect` + `setState`, which
  // the React Compiler lint forbids in this codebase.
  const message = state?.error ?? state?.detail ?? null;

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={formAction}>
        <input type="hidden" name="paymentId" value={paymentId} />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          title={
            status === "allocating"
              ? "Retry this approval"
              : "Approve and apply this payment to outstanding bills"
          }
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : status === "allocating" ? (
            <RotateCw className="h-3.5 w-3.5" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" />
          )}
          {pending ? "Approving…" : status === "allocating" ? "Retry" : "Approve"}
        </button>
      </form>
      {message ? (
        <span
          className={`max-w-[16rem] text-right text-[11px] leading-tight ${
            state?.error
              ? isDark
                ? "text-rose-300"
                : "text-rose-700"
              : isDark
                ? "text-emerald-300"
                : "text-emerald-700"
          }`}
        >
          {message}
        </span>
      ) : null}
    </div>
  );
}
