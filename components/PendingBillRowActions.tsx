"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { deletePendingBill } from "@/app/actions/pendingBills";
import type { ActionResult } from "@/lib/types";

/** Pencil (edit page) + Trash (server action) for one Pending Bills table row. */
export function PendingBillRowActions({
  id,
  referenceNo,
  home,
}: {
  id: string;
  referenceNo: string;
  home: string;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | undefined, FormData>(
    deletePendingBill,
    undefined
  );

  return (
    <div className="flex gap-2">
      <Link
        href={`${home}/pending-bills/${id}/edit`}
        className="cursor-pointer rounded-md border border-theme p-1.5 text-theme-muted transition hover:border-indigo-500/50 hover:text-indigo-500"
        aria-label={`Edit ${referenceNo}`}
      >
        <Pencil className="h-3.5 w-3.5" />
      </Link>
      <form action={formAction}>
        <input type="hidden" name="id" value={id} />
        <button
          type="submit"
          disabled={pending}
          className="cursor-pointer rounded-md border border-theme p-1.5 text-theme-muted transition hover:border-rose-500/50 hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={`Delete ${referenceNo}`}
          title={state && !state.ok ? state.error : `Delete ${referenceNo}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </form>
    </div>
  );
}
