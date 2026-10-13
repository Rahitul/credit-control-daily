"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Check, Pencil, Trash2 } from "lucide-react";
import {
  approveCustomerAction,
  deleteCustomer,
} from "@/app/actions/customers";
import type { ActionResult } from "@/lib/types";

/**
 * Edit (pencil) + Delete (trash, admin only) for one Customers table row.
 *
 * Approve is also rendered here, but only while the customer is still pending —
 * an approved row shows `approvedByName` as plain text instead, matching the
 * pre-existing "by <approver>" cell.
 */
export function CustomerRowActions({
  id,
  name,
  home,
  approvalStatus,
  approvedByName,
  canApprove,
  canDelete,
}: {
  id: string;
  name: string;
  home: string;
  approvalStatus: "pending" | "approved";
  approvedByName?: string;
  canApprove: boolean;
  canDelete: boolean;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | undefined, FormData>(
    deleteCustomer,
    undefined
  );

  return (
    <div className="flex justify-end gap-2">
      <Link
        href={`${home}/customers/${id}/edit`}
        className="cursor-pointer rounded-md border border-theme p-1.5 text-theme-muted transition hover:border-indigo-500/50 hover:text-indigo-500"
        aria-label={`Edit ${name}`}
        title={`Edit ${name}`}
      >
        <Pencil className="h-3.5 w-3.5" />
      </Link>

      {canApprove && approvalStatus === "pending" ? (
        <form action={approveCustomerAction}>
          <input type="hidden" name="id" value={id} />
          <button
            type="submit"
            className="btn-primary cursor-pointer px-3 py-1.5 text-xs"
            title={`Approve ${name}`}
          >
            Approve
          </button>
        </form>
      ) : canApprove && approvedByName ? (
        <span className="self-center text-xs text-zinc-500">by {approvedByName}</span>
      ) : null}

      {canDelete ? (
        <form action={formAction}>
          <input type="hidden" name="id" value={id} />
          <button
            type="submit"
            disabled={pending}
            className="cursor-pointer rounded-md border border-theme p-1.5 text-theme-muted transition hover:border-rose-500/50 hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={`Delete ${name}`}
            title={state && !state.ok ? state.error : `Delete ${name}`}
          >
            {pending ? (
              <Check className="h-3.5 w-3.5 animate-pulse" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </button>
        </form>
      ) : null}
    </div>
  );
}
