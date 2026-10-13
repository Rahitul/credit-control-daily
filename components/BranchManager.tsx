"use client";

import { useActionState, useState } from "react";
import { GitFork, Pencil, Plus, Trash2 } from "lucide-react";
import { createBranch, deleteBranch, updateBranch } from "@/app/actions/branches";
import { ErrorBanner, Field, SuccessBanner } from "@/components/form";
import type { ActionResult } from "@/lib/types";

export type BranchRow = {
  id: string;
  name: string;
  prefix: string;
  active: boolean;
  note: string;
};

const select = "input-field";

export function BranchManager({ rows }: { rows: BranchRow[] }) {
  const [addState, addForm, addPending] = useActionState<ActionResult | undefined, FormData>(
    createBranch,
    undefined
  );
  const [updateState, updateForm, updatePending] = useActionState<
    ActionResult | undefined,
    FormData
  >(updateBranch, undefined);
  const [deleteState, deleteForm, deletePending] = useActionState<
    ActionResult | undefined,
    FormData
  >(deleteBranch, undefined);

  // Inline edit, same "one row at a time" shape UserManager uses. `null` means the
  // add form is the only thing on screen.
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="surface-card p-5 lg:col-span-2">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-theme-muted">
          <Plus className="h-4 w-4" />
          Add Branch
        </h2>
        <SuccessBanner message={addState?.ok ? "Branch created." : undefined} />
        <ErrorBanner message={addState && !addState.ok ? addState.error : undefined} />
        <form action={addForm} className="grid gap-4">
          <Field label="Branch Name" required>
            <input name="name" required className={select} placeholder="e.g. Bogura" />
          </Field>
          <Field label="Bill Prefix" required>
            <input
              name="prefix"
              required
              className={select}
              placeholder="e.g. BOG"
              maxLength={12}
            />
          </Field>
          <Field label="Note">
            <input name="note" className={select} placeholder="Optional" />
          </Field>
          <button type="submit" disabled={addPending} className="btn-primary">
            {addPending ? "Adding…" : "Add Branch"}
          </button>
        </form>
        <p className="mt-4 text-xs text-theme-muted">
          The prefix is matched <strong>anywhere</strong> inside a bill reference, so
          it decides which app a bill lands in. Two or more letters, no digits, and
          it cannot be a department code (TS, CW, WO, S, W).
        </p>
        <p className="mt-2 text-xs text-theme-muted">
          A branch is an office, not a department. Which department a bill belongs to
          still comes from its reference number, so one branch bill can sit in
          <em> Branches</em> and a department app at the same time.
        </p>
      </div>

      <div className="surface-card overflow-hidden lg:col-span-3">
        <div className="border-b border-theme p-4">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-theme-muted">
            <GitFork className="h-4 w-4" />
            Branches
          </div>
        </div>

        <SuccessBanner message={updateState?.ok ? "Branch updated." : undefined} />
        <ErrorBanner message={updateState && !updateState.ok ? updateState.error : undefined} />
        <ErrorBanner message={deleteState && !deleteState.ok ? deleteState.error : undefined} />

        {rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-theme-muted">
            No branches yet. Add one on the left — until you do, no bill routes to the
            branches app.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-dark">
              <thead>
                <tr>
                  <th>Branch</th>
                  <th>Prefix</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) =>
                  editing === row.id ? (
                    <tr key={row.id}>
                      <td colSpan={4}>
                        <form action={updateForm} className="grid gap-3">
                          <input type="hidden" name="id" value={row.id} />
                          <div className="grid gap-3 sm:grid-cols-2">
                            <Field label="Branch Name" required>
                              <input
                                name="name"
                                required
                                defaultValue={row.name}
                                className={select}
                              />
                            </Field>
                            <Field label="Bill Prefix" required>
                              <input
                                name="prefix"
                                required
                                defaultValue={row.prefix}
                                className={select}
                                maxLength={12}
                              />
                            </Field>
                            <Field label="Status">
                              <select
                                name="active"
                                className={select}
                                defaultValue={row.active ? "true" : "false"}
                              >
                                <option value="true">Active</option>
                                <option value="false">Inactive</option>
                              </select>
                            </Field>
                          </div>
                          <Field label="Note">
                            <input
                              name="note"
                              defaultValue={row.note}
                              className={select}
                            />
                          </Field>
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setEditing(null)}
                              className="btn-ghost"
                            >
                              Cancel
                            </button>
                            <button
                              type="submit"
                              disabled={updatePending}
                              className="btn-primary"
                            >
                              {updatePending ? "Saving…" : "Save"}
                            </button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  ) : (
                    <tr key={row.id}>
                      <td className="font-medium text-zinc-100">{row.name}</td>
<td>
                      <span className="pill pill-indigo font-mono">{row.prefix}</span>
                    </td>
                    <td>
                      <span
                        className={row.active ? "pill pill-green" : "pill pill-amber"}
                      >
                        {row.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                      <td className="text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setEditing(row.id)}
                            className="inline-flex items-center gap-1 rounded-lg border border-theme px-2.5 py-1 text-xs text-theme transition hover:bg-theme-surface"
                            title={`Edit ${row.name}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </button>
                          <form action={deleteForm} className="inline">
                            <input type="hidden" name="id" value={row.id} />
                            <button
                              type="submit"
                              disabled={deletePending}
                              className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 px-2.5 py-1 text-xs text-rose-500 transition hover:bg-rose-500/10 disabled:opacity-60"
                              title={`Delete ${row.name}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Delete
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
