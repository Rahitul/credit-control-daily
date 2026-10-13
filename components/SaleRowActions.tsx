"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { deleteSale } from "@/app/actions/sales";
import type { ActionResult } from "@/lib/types";

export function SaleRowActions({
  id,
  referenceId,
  home,
}: {
  id: string;
  referenceId: string;
  home: string;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | undefined, FormData>(
    deleteSale,
    undefined
  );

  return (
    <div className="flex gap-2">
      <Link
        href={`${home}/sales/${id}/edit`}
        className="cursor-pointer rounded-md border border-theme p-1.5 text-theme-muted transition hover:border-indigo-500/50 hover:text-indigo-500"
        aria-label={`Edit ${referenceId}`}
      >
        <Pencil className="h-3.5 w-3.5" />
      </Link>
      <form action={formAction}>
        <input type="hidden" name="id" value={id} />
        <button
          type="submit"
          disabled={pending}
          className="cursor-pointer rounded-md border border-theme p-1.5 text-theme-muted transition hover:border-rose-500/50 hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={`Delete ${referenceId}`}
          title={state && !state.ok ? state.error : `Delete ${referenceId}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </form>
    </div>
  );
}
