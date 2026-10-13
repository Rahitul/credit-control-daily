"use client";

import { useActionState } from "react";
import { Loader2, XCircle } from "lucide-react";
import { rejectPayment } from "@/app/actions/payments";
import type { PaymentApprovalStatus } from "@/lib/models/Payment";
import { useTheme } from "@/components/ThemeProvider";

/**
 * Reject one PENDING payment — a hard delete, so the browser confirms first.
 *
 * Only ever offered on `pending` rows (an approved payment has already moved
 * money and must not be removable), and only inside the Action column, which
 * the view gates to Accounts/Admin. The server action re-checks both, so this
 * button is a convenience — it can never grant a permission the action refuses.
 */
export function PaymentRejectButton({
  paymentId,
  status,
  canReject,
}: {
  paymentId: string;
  status: PaymentApprovalStatus | string;
  canReject: boolean;
}) {
  const [state, formAction, pending] = useActionState(rejectPayment, undefined);
  const { theme } = useTheme();
  const isDark = theme === "dark";

  if (status !== "pending" || !canReject) return null;

  const message = state?.error ?? state?.detail ?? null;

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={formAction}>
        <input type="hidden" name="paymentId" value={paymentId} />
        <button
          type="submit"
          disabled={pending}
          onClick={(e) => {
            if (!confirm("Reject this payment? It will be deleted permanently.")) {
              e.preventDefault();
            }
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-rose-700 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-60"
          title="Reject and permanently delete this pending payment"
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <XCircle className="h-3.5 w-3.5" />
          )}
          {pending ? "Rejecting…" : "Reject"}
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
