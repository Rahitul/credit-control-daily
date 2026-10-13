import Link from "next/link";
import type { ReactNode } from "react";
import { FilterBarForm } from "@/components/FilterBarForm";

export type SearchParams = Record<string, string | string[] | undefined>;

export function fstr(params: SearchParams, key: string): string {
  const v = params[key];
  return typeof v === "string" ? v : "";
}

export function hasAnyFilter(params: SearchParams, keys: string[]): boolean {
  return keys.some((k) => fstr(params, k) !== "");
}

export function FilterLabel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wider text-theme-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

export function FilterRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-end gap-3">{children}</div>;
}

export function FilterBar({
  clearHref,
  hasFilters,
  children,
  search,
}: {
  clearHref: string;
  hasFilters: boolean;
  children: ReactNode;
  /** Optional first-row field (e.g. Search) alone above the rest */
  search?: ReactNode;
}) {
  return (
    // Auto-submit on change via the client `FilterBarForm` — there is no Apply
    // button anymore; Clear is the only explicit control left.
    <FilterBarForm className="surface-card mb-4 space-y-3 p-4">
      {search ? <FilterRow>{search}</FilterRow> : null}
      <FilterRow>
        {children}
        {hasFilters ? (
          <Link href={clearHref} className="btn-ghost">
            Clear
          </Link>
        ) : null}
      </FilterRow>
    </FilterBarForm>
  );
}

export function optionList(values: readonly string[], allLabel: string) {
  return [{ value: "", label: allLabel }, ...values.map((v) => ({ value: v, label: v }))];
}
