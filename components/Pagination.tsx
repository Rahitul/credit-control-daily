import Link from "next/link";
import { pageHref } from "@/lib/pagination";
import type { SearchParams } from "@/components/filters";

/**
 * Pager bar for the register tables — "Showing 21–40 of 95 · Page 2 of 5" with
 * Prev/Next links that carry the CURRENT filter params (only `?page=` changes).
 * Renders nothing when everything fits on one page, so short lists look
 * exactly as they did before pagination existed.
 */
export function Pagination({
  path,
  params,
  page,
  totalPages,
  total,
  start,
  end,
}: {
  /** The list's base path, e.g. `${home}/sales`. */
  path: string;
  /** The current search params, so pager links keep every active filter. */
  params: SearchParams;
  page: number;
  totalPages: number;
  total: number;
  start: number;
  end: number;
}) {
  if (totalPages <= 1) return null;
  const prev = page > 1 ? pageHref(path, params, page - 1) : null;
  const next = page < totalPages ? pageHref(path, params, page + 1) : null;
  const btn =
    "btn-ghost cursor-pointer px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-theme px-4 py-3">
      <p className="text-xs text-theme-muted">
        Showing {start}–{end} of {total}
      </p>
      <div className="flex items-center gap-2">
        {prev ? (
          <Link href={prev} className={btn} rel="prev">
            ‹ Prev
          </Link>
        ) : (
          <span className={`${btn} pointer-events-none opacity-40`}>‹ Prev</span>
        )}
        <span className="text-xs text-theme-muted">
          Page {page} of {totalPages}
        </span>
        {next ? (
          <Link href={next} className={btn} rel="next">
            Next ›
          </Link>
        ) : (
          <span className={`${btn} pointer-events-none opacity-40`}>Next ›</span>
        )}
      </div>
    </div>
  );
}
