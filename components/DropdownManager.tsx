"use client";

import { useActionState, useState } from "react";
import { ListChecks, Plus, Trash2 } from "lucide-react";
import { addDropdownOption, deleteDropdownOption } from "@/app/actions/dropdowns";
import { ErrorBanner, Field, SuccessBanner } from "@/components/form";
import { DROPDOWN_TYPES, type DropdownType } from "@/lib/types";
import type { ActionResult } from "@/lib/types";

export type DropdownRow = {
  id: string;
  type: DropdownType;
  value: string;
};

const TAB_META: Record<
  DropdownType,
  { label: string; plural: string; placeholder: string; where: string }
> = {
  category: {
    label: "Category",
    plural: "Categories",
    placeholder: "e.g. Wholesale",
    where: "customer form category",
  },
  branch: {
    label: "Branch",
    plural: "Branches",
    placeholder: "e.g. Dhaka",
    where: "customer / payment form branch",
  },
  billCategory: {
    label: "Bill Category",
    plural: "Bill Categories",
    placeholder: "e.g. Invoice",
    where: "new payment form bill category",
  },
  paymentType: {
    label: "Payment Type",
    plural: "Payment Types",
    placeholder: "e.g. Cash",
    where: "new payment form payment type",
  },
  bankType: {
    label: "Bank Type",
    plural: "Bank Types",
    placeholder: "e.g. City Bank",
    where: "new payment form bank type",
  },
  bankName: {
    label: "Bank Name",
    plural: "Bank Names",
    placeholder: "e.g. Dhanmondi",
    where: "new payment form bank name / branch",
  },
};

const TAB_ORDER: DropdownType[] = [...DROPDOWN_TYPES];

export function DropdownManager({ rows }: { rows: DropdownRow[] }) {
  const [tab, setTab] = useState<DropdownType>("category");
  const [addState, addForm, addPending] = useActionState<ActionResult | undefined, FormData>(
    addDropdownOption,
    undefined
  );
  const [deleteState, deleteForm, deletePending] = useActionState<
    ActionResult | undefined,
    FormData
  >(deleteDropdownOption, undefined);

  const list = rows
    .filter((r) => r.type === tab)
    .sort((a, b) => a.value.localeCompare(b.value));

  const meta = TAB_META[tab];

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="surface-card p-5 lg:col-span-2">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-theme-muted">
          <Plus className="h-4 w-4" />
          Add {meta.label}
        </h2>
        <SuccessBanner message={addState?.ok ? `${meta.label} added.` : undefined} />
        <ErrorBanner
          message={addState && !addState.ok ? addState.error : undefined}
        />
        <form action={addForm} className="grid gap-4">
          <input type="hidden" name="type" value={tab} />
          <Field label={meta.label} required>
            <input
              name="value"
              required
              className="input-field"
              placeholder={meta.placeholder}
            />
          </Field>
          <button type="submit" disabled={addPending} className="btn-primary">
            {addPending ? "Adding…" : `Add ${meta.label}`}
          </button>
        </form>
        <p className="mt-4 text-xs text-theme-muted">
          Options appear in the {meta.where} after saving.
        </p>
      </div>

      <div className="surface-card overflow-hidden lg:col-span-3">
        <div className="border-b border-theme p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-theme-muted">
            <ListChecks className="h-4 w-4" />
            Dropdown Options
          </div>
          <div className="flex flex-wrap items-center gap-1 rounded-xl border border-theme bg-theme-surface p-1 text-xs font-medium">
            {TAB_ORDER.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`rounded-lg px-2.5 py-1.5 transition-all ${
                  tab === t
                    ? "bg-indigo-600 text-white"
                    : "text-theme-muted hover:text-theme"
                }`}
              >
                {TAB_META[t].plural}
              </button>
            ))}
          </div>
        </div>

        <ErrorBanner
          message={deleteState && !deleteState.ok ? deleteState.error : undefined}
        />

        {list.length === 0 ? (
          <p className="p-8 text-center text-sm text-theme-muted">
            No {meta.label.toLowerCase()} options yet. Add one on the left.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-dark">
              <thead>
                <tr>
                  <th>{meta.label}</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {list.map((row) => (
                  <tr key={row.id}>
                    <td className="font-medium text-zinc-100">{row.value}</td>
                    <td className="text-right">
                      <form action={deleteForm} className="inline">
                        <input type="hidden" name="id" value={row.id} />
                        <input type="hidden" name="type" value={row.type} />
                        <input type="hidden" name="value" value={row.value} />
                        <button
                          type="submit"
                          disabled={deletePending}
                          className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 px-2.5 py-1 text-xs text-rose-500 transition hover:bg-rose-500/10 disabled:opacity-60"
                          title={`Delete ${row.value}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
