/**
 * Branches — the MONGOOSE-FREE half.
 *
 * A branch is a physical location (Bogura, Chittagong) whose **prefix** is matched
 * anywhere inside a bill reference to decide which app the bill lands in. See
 * `routeReference()` in `lib/pendingBills.ts` for the routing itself; the database
 * half lives in `lib/branchesData.ts` and the model in `lib/models/Branch.ts`.
 *
 * Kept free of mongoose so the admin form can import the validators and show the
 * reason a prefix was rejected without pulling the driver into the browser.
 */

/**
 * The minimum shape the router needs. Deliberately not the Mongoose document —
 * every write path passes plain objects read from one lean query.
 */
export type BranchRouteInput = {
  id: string;
  name: string;
  prefix: string;
};

/** Longest prefix first, then alphabetically, so a longer rule always wins. */
export function sortBranchPrefixes(
  branches: readonly BranchRouteInput[]
): BranchRouteInput[] {
  return [...branches]
    .filter((b) => b.prefix.trim())
    .sort(
      (a, b) =>
        b.prefix.length - a.prefix.length || a.prefix.localeCompare(b.prefix)
    );
}

/**
 * The branch a reference belongs to, or `null`.
 *
 * Matched as a **substring anywhere** in the reference, case-insensitively,
 * because branch references interleave the branch with the company and the
 * department code: `IOM/BOG/TS-040`, `WO/IM/SYL-002`, `WOCB-26/26-27`. A
 * leading-token match would catch none of those. That breadth is exactly why
 * `validateBranchPrefix()` is strict — see its docblock.
 */
export function matchBranch(
  referenceNo: string,
  branches: readonly BranchRouteInput[]
): BranchRouteInput | null {
  const haystack = referenceNo.toUpperCase();
  if (!haystack) return null;
  for (const branch of sortBranchPrefixes(branches)) {
    if (haystack.includes(branch.prefix.trim().toUpperCase())) return branch;
  }
  return null;
}

/**
 * The department codes a branch prefix must not collide with.
 *
 * `matchBranch` runs BEFORE the department rules are consulted for ordering, and
 * a branch called `S` or `TS` would capture every bill in the register.
 */
const RESERVED_PREFIXES = ["TS", "CW", "WO", "S", "W"] as const;

/**
 * Normalise a typed prefix, or explain why it cannot be used.
 *
 * Because branch prefixes are matched as bare substrings anywhere in a reference,
 * an over-broad prefix silently captures unrelated bills and there is no way to
 * undo it from the UI. The rules below are the guard:
 *
 * - 2+ characters, so a one-letter prefix cannot match everything.
 * - Letters only, so a prefix can never match the `dt.14.3.2026` date part or
 *   a digit inside a bill number.
 * - Not a department code, so branch routing and department routing can never
 *   fight over the same bill.
 */
export function validateBranchPrefix(raw: string): {
  ok: true;
  prefix: string;
} | { ok: false; error: string } {
  const prefix = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!prefix) return { ok: false, error: "Prefix is required." };
  if (!/^[A-Z]+$/.test(prefix)) {
    return {
      ok: false,
      error: "Prefix must be letters only (A–Z) — no digits, spaces or punctuation.",
    };
  }
  if (prefix.length < 2) {
    return {
      ok: false,
      error: "Prefix must be at least 2 characters. A single letter would match almost every bill reference.",
    };
  }
  if ((RESERVED_PREFIXES as readonly string[]).includes(prefix)) {
    return {
      ok: false,
      error: `"${prefix}" is a department code (TS, CW, WO, S, W). Pick a different prefix so bill routing stays unambiguous.`,
    };
  }
  return { ok: true, prefix };
}

export type BranchNameResult =
  | { ok: true; name: string }
  | { ok: false; error: string };

export function validateBranchName(raw: string): BranchNameResult {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, error: "Branch name is required." };
  if (name.length > 60) {
    return { ok: false, error: "Branch name must be 60 characters or fewer." };
  }
  return { ok: true, name };
}
