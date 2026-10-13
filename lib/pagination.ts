/**
 * Pure list-pagination helpers, shared by every paginated register view
 * (Sales, Customers, Payments, Pending/Completed Bills). No DB, no React.
 */

/** Rows shown on one page of a register table. */
export const PER_PAGE = 20;

/** The Next.js search-params shape (same as `SearchParams` in `components/filters`). */
type PageParams = Record<string, string | string[] | undefined>;

/**
 * Read `?page=` from the URL into a safe 1-based page number. Missing,
 * zero, negative, garbage or a float all become page 1 — the `paginate`
 * clamp then handles the upper bound once the total is known.
 */
export function parsePage(raw: string): number {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Slice `rows` down to one page. Totals/counts elsewhere in the view stay on
 * the FULL filtered array — only the `<tbody>` map uses `pageRows`. Out-of-range
 * pages clamp into range (e.g. deleting a filter while deep in the list).
 */
export function paginate<T>(rows: readonly T[], page: number, perPage = PER_PAGE) {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * perPage;
  return {
    pageRows: rows.slice(start, start + perPage),
    page: safePage,
    totalPages,
    total,
    start: total === 0 ? 0 : start + 1,
    end: Math.min(start + perPage, total),
  };
}

/**
 * Build a pager href: same path, same filter params, one page number changed.
 * Empty params and page 1 produce a clean URL with no query string.
 */
export function pageHref(path: string, params: PageParams, page: number): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (k === "page") continue;
    if (typeof v === "string" && v !== "") qs.set(k, v);
  }
  if (page > 1) qs.set("page", String(page));
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}
