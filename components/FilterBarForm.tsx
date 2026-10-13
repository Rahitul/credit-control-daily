"use client";

import { type FormEvent, type ReactNode } from "react";

/**
 * The GET form behind `FilterBar`: filters apply AUTOMATICALLY when a
 * SELECT / date / number / checkbox changes — no Apply button. Text and
 * search boxes: type freely, submit on Enter (the form's native GET submit) —
 * a keystroke never fires a request. EXCEPTION: emptying the box (deleting
 * the last character) auto-submits immediately, so clearing a search refreshes
 * the list without pressing Enter. Submitting is the exact same GET
 * navigation the old Apply button performed: only the named filter fields go
 * into the query string, so a filter change also resets `?page=` back to
 * page 1.
 *
 * This lives in its own client module because `components/filters.tsx` also
 * exports plain helpers (`fstr`, `hasAnyFilter`) that server components call —
 * tagging that whole file `"use client"` would turn those calls into client
 * references and break the list views.
 */
export function FilterBarForm({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const handleChange = (e: FormEvent<HTMLFormElement>) => {
    const el = e.target as HTMLElement | null;
    if (!el) return;
    const tag = el.tagName;
    const type = (el as HTMLInputElement).type ?? "text";
    const immediate =
      tag === "SELECT" ||
      (tag === "INPUT" && type !== "text" && type !== "search");
    const form = e.currentTarget as HTMLFormElement;
    if (immediate) {
      form.requestSubmit();
      return;
    }
    // Text/search box: only auto-submit when it has just been EMPTIED —
    // clearing the filter refreshes instantly; typing waits for Enter.
    if (tag === "INPUT" && (el as HTMLInputElement).value === "") {
      form.requestSubmit();
    }
  };

  return (
    <form method="GET" className={className} onChange={handleChange}>
      {/* Invisible submit button — makes Enter work on ANY field. Browsers
          only do implicit form submission when there is exactly one
          submission-blocking field (text/search/date/number) OR a submit
          button; the Customers list has just one such field (its search box),
          while the other lists have several, so Enter would do nothing there
          without this. `sr-only` = no layout impact; no `name` = nothing
          added to the query string. */}
      <button type="submit" className="sr-only" aria-hidden="true" tabIndex={-1}>
        Apply filters
      </button>
      {children}
    </form>
  );
}
