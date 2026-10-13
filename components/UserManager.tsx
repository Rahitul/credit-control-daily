"use client";

import { useActionState, useMemo, useState } from "react";
import { Pencil, Trash2, Search } from "lucide-react";
import { createUser, deleteUser, updateUser } from "@/app/actions/users";
import { ErrorBanner, Field, SuccessBanner } from "@/components/form";
import { ROLES, ROLE_LABELS, type ActionResult, type Role } from "@/lib/types";

export type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  roles: Role[];
  department?: string;
  /** The `Branch` this user is assigned to, as a plain string id. */
  branchId?: string;
  /** Branch name resolved at read time, so a rename shows up without a lookup here. */
  branchName?: string;
  status: "active" | "inactive";
};

export type BranchPick = { id: string; name: string; prefix: string; active: boolean };

export function UserManager({
  users,
  currentUserId,
  branches,
}: {
  users: AdminUserRow[];
  currentUserId: string;
  branches: BranchPick[];
}) {
  const [createState, createForm, createPending] = useActionState<
    ActionResult | undefined,
    FormData
  >(createUser, undefined);
  const [editState, editForm, editPending] = useActionState<
    ActionResult | undefined,
    FormData
  >(updateUser, undefined);
  const [deleteState, deleteForm, deletePending] = useActionState<
    ActionResult | undefined,
    FormData
  >(deleteUser, undefined);
  const [editing, setEditing] = useState<string | null>(null);
const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");

  // unused; branch select replaced by radio buttons under Roles/Branches

    const NO_BRANCH = "unassigned"; // eslint-disable-line @typescript-eslint/no-unused-vars

const visible = useMemo(() => {
    return users.filter((u) => {
      const hay = [
        u.name,
        u.email,
        u.department ?? "",
        u.branchName ?? "",
        u.roles.join(" "),
      ]
        .join(" ")
        .toLowerCase();
      if (q && !hay.includes(q.toLowerCase())) return false;
      if (role && !u.roles.includes(role as Role)) return false;
      if (status && u.status !== status) return false;
      return true;
    });
  }, [users, q, role, status]);
  const hasFilters = !!(q || role || status);

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="surface-card p-5 lg:col-span-2">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-theme-muted">
          Add User
        </h2>
        <SuccessBanner message={createState?.ok ? "User created." : undefined} />
        <ErrorBanner
          message={createState && !createState.ok ? createState.error : undefined}
        />
        <form action={createForm} className="grid gap-4">
          <Field label="Name" required>
            <input name="name" required className="input-field" />
          </Field>
          <Field label="Email" required>
            <input name="email" type="email" required className="input-field" />
          </Field>
          <Field label="Password" required>
            <input
              name="password"
              type="password"
              required
              minLength={6}
              className="input-field"
            />
          </Field>
          <Field label="Roles" required>
            <div className="flex flex-wrap gap-4">
              {ROLES.filter((r) => r !== "branches").map((r) => (
                <label key={r} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="roles" value={r} />
                  <span>{ROLE_LABELS[r]}</span>
                </label>
              ))}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="roles" value="branches" />
                <span>{ROLE_LABELS.branches}</span>
              </label>
              <div className="w-full mt-2 flex flex-wrap gap-4">
                <span className="text-xs text-theme-muted w-full">Branches</span>
                {branches.length === 0 ? (
                  <span className="text-xs text-theme-muted">
                    No branches added yet. Add from Admin → Branches.
                  </span>
                ) : (
                  branches.map((b) => (
                    <label key={b.id} className="flex items-center gap-2 text-sm">
                      <input type="radio" name="branchId" value={b.id} />
                      <span>
                        {b.name} ({b.prefix}){b.active ? "" : " — inactive"}
                      </span>
                    </label>
                  ))
                )}
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="branchId" value="" defaultChecked />
                  <span>No branch</span>
                </label>
              </div>
            </div>
          </Field>
          <Field label="Status">
            <select name="status" className="input-field" defaultValue="active">
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </Field>
          <button type="submit" disabled={createPending} className="btn-primary">
            {createPending ? "Creating…" : "Create User"}
          </button>
        </form>
      </div>

      <div className="surface-card overflow-hidden lg:col-span-3">
        <div className="space-y-3 border-b border-theme p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex w-full flex-col gap-1 sm:w-auto sm:flex-1">
              <span className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-theme-muted">
                <Search className="h-3 w-3" />
                Search
              </span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Name, email…"
                className="input-field w-full"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-medium uppercase tracking-wider text-theme-muted">
                Role
              </span>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="input-field w-36"
              >
                <option value="">All roles</option>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
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
                className="input-field w-32"
              >
                <option value="">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            {hasFilters ? (
      <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => {
                  setQ("");
                  setRole("");
                  setStatus("");
                }}
              >
                Clear
              </button>
            ) : null}
            <span className="ml-auto text-sm text-theme-muted">{visible.length} user(s)</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="table-dark">
            <thead>
              <tr>
                <th>User</th>
                <th>Roles</th>
                <th>Branch</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((u) => (
                <tr key={u.id}>
                  <td>
                    <p className="font-medium text-zinc-100">{u.name}</p>
                    <p className="text-xs text-zinc-500">{u.email}</p>
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {u.roles.map((r) => (
                        <span key={r} className="pill pill-indigo">
                          {ROLE_LABELS[r]}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    {u.branchName ? (
                      <span className="pill pill-indigo">{u.branchName}</span>
                    ) : (
                      <span className="text-xs text-theme-muted">—</span>
                    )}
                  </td>
                  <td>
                    <span
                      className={`pill ${u.status === "active" ? "pill-green" : "pill-zinc"}`}
                    >
                      {u.status}
                    </span>
                  </td>
                  <td>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setEditing(editing === u.id ? null : u.id)}
                        className="cursor-pointer rounded-md border border-theme p-1.5 text-theme-muted transition hover:border-indigo-500/50 hover:text-indigo-500"
                        aria-label={`Edit ${u.name}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      {u.id !== currentUserId ? (
                        <form action={deleteForm}>
                          <input type="hidden" name="id" value={u.id} />
                          <button
                            type="submit"
                            disabled={deletePending}
                            className="cursor-pointer rounded-md border border-theme p-1.5 text-theme-muted transition hover:border-rose-500/50 hover:text-rose-500"
                            aria-label={`Delete ${u.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-sm text-theme-muted">
                    No users match your filters.
                  </td>
                </tr>
              ) : null}
              {editing && !visible.some((u) => u.id === editing) ? null : editing ? (
                <tr>
                  <td colSpan={5} className="bg-theme-surface">
                    {(() => {
                      const u = users.find((x) => x.id === editing);
                      if (!u) return null;
                      return (
                        <div className="p-4">
                          <SuccessBanner
                            message={editState?.ok ? "User updated." : undefined}
                          />
                          <ErrorBanner
                            message={
                              editState && !editState.ok ? editState.error : undefined
                            }
                          />
                          <form action={editForm} className="grid gap-4 sm:grid-cols-2">
                            <input type="hidden" name="id" value={u.id} />
                            <Field label="Name" required>
                              <input
                                name="name"
                                defaultValue={u.name}
                                required
                                className="input-field"
                              />
                            </Field>
                            <Field label="Email" required>
                              <input
                                name="email"
                                type="email"
                                defaultValue={u.email}
                                required
                                className="input-field"
                              />
                            </Field>
                            <Field label="New Password (optional)">
                              <input
                                name="password"
                                type="password"
                                className="input-field"
                                placeholder="Leave blank to keep"
                              />
                            </Field>
                            <Field label="Roles" required>
                              <div className="flex flex-wrap gap-4">
                            {ROLES.filter((r) => r !== "branches").map((r) => (
                              <label key={r} className="flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  name="roles"
                                  value={r}
                                  defaultChecked={u.roles.includes(r)}
                                />
                                <span>{ROLE_LABELS[r]}</span>
                              </label>
                            ))}
                            <label className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                name="roles"
                                value="branches"
                                defaultChecked={u.roles.includes("branches")}
                              />
                              <span>{ROLE_LABELS.branches}</span>
                            </label>
                            <div className="w-full mt-2 flex flex-wrap gap-4">
                              <span className="text-xs text-theme-muted w-full">Branches</span>
                              {branches.length === 0 ? (
                                <span className="text-xs text-theme-muted">
                                  No branches added yet.
                                </span>
                              ) : (
                                branches.map((b) => (
                                  <label key={b.id} className="flex items-center gap-2 text-sm">
                                    <input
                                      type="radio"
                                      name="branchId"
                                      value={b.id}
                                      defaultChecked={u.branchId === b.id}
                                    />
                                    <span>
                                      {b.name} ({b.prefix}){b.active ? "" : " — inactive"}
                                    </span>
                                  </label>
                                ))
                              )}
                              <label className="flex items-center gap-2 text-sm">
                                <input
                                  type="radio"
                                  name="branchId"
                                  value=""
                                  defaultChecked={!u.branchId}
                                />
                                <span>No branch</span>
                              </label>
                            </div>
                              </div>
                            </Field>
                            <Field label="Status">
                              <select
                                name="status"
                                defaultValue={u.status}
                                className="input-field"
                              >
                                <option value="active">Active</option>
                                <option value="inactive">Inactive</option>
                              </select>
                            </Field>
                            <div className="flex items-end gap-2">
                              <button
                                type="submit"
                                disabled={editPending}
                                className="btn-primary"
                              >
                                {editPending ? "Saving…" : "Save Changes"}
                              </button>
                              <button
                                type="button"
                                className="btn-ghost"
                                onClick={() => setEditing(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          </form>
                        </div>
                      );
                    })()}
                  </td>
                </tr>
              ) : null}
              {deleteState && !deleteState.ok ? (
                <tr>
                  <td colSpan={5}>
                    <ErrorBanner message={deleteState.error} />
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
