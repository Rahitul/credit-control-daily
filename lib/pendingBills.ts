/**
 * Shared, MONGOOSE-FREE core of the Pending Bills register.
 *
 * Everything here is pure so it can be imported by the client form for the live
 * Ref. No. hint. The database half lives in `lib/pendingBillsData.ts` — do not
 * move it here or the form pulls mongoose into the browser bundle.
 *
 * ## The composite Ref. No.
 *
 * Col B is one string that carries both the bill number and the bill date:
 *
 *     TS-1854 dt.14.3.2026
 *     └─ bill number ─┘ └ date: 14 Mar 2026
 *
 * There is deliberately NO bill-number form field and NO bill-number Excel
 * column. The number is parsed out of the reference and *persisted* as
 * `PendingBill.billNumber` so it is queryable, but it is never typed by hand.
 */

import { formatDate, toDateInput } from "@/lib/format";
import { matchBranch, type BranchRouteInput } from "@/lib/branches";
import { ROLE_LABELS, type Role } from "@/lib/types";

/** Source of the department routing decision. */
export type DepartmentSource = "mapping" | "auto";

/** Result of department resolution with source tracking. */
export interface ResolvedDepartments {
  departments: Role[];
  source: DepartmentSource;
  billNumber: string;
}

// Re-export Role for consumers
export type { Role };

/** Hard cap on a single import. `next.config.ts` caps the body at 10 MB. */
export const IMPORT_MAX_ROWS = 5000;

/* ------------------------------------------------------------------ */
/* Department routing                                                  */
/* ------------------------------------------------------------------ */

export type BillRoute = {
  /** Bill-number prefix, matched case-insensitively, longest first. */
  prefix: string;
  /** Department app(s) the bill appears in. */
  departments: Role[];
  /** Human label for the live hint. */
  label: string;
};

/**
 * TS → Consumable, WO → EID, S → Sales. A bill number matching none of these is
 * "unrouted": it stays in Accounts only and is flagged with a warning.
 *
 * This table is NOT the whole story any more — branch prefixes (Admin-managed, see
 * `lib/branches.ts`) route on top of it via `routeReference()`. This table itself
 * is deliberately unchanged: `routeReference()` always runs it and only ever
 * ADDS to the result, so no bill that routes today can move app.
 */
export const BILL_ROUTES: readonly BillRoute[] = [
  { prefix: "TS", departments: ["consumable"], label: "Consumable" },
  { prefix: "CW", departments: ["esbd"], label: "ESBD" },
  { prefix: "WO", departments: ["eid"], label: "EID" },
  { prefix: "S", departments: ["sales"], label: "Sales" },
];

/** Longest prefix first, so a 2-letter rule can never be shadowed by a 1-letter one. */
const ROUTES_BY_LENGTH = [...BILL_ROUTES].sort(
  (a, b) => b.prefix.length - a.prefix.length
);

/** The leading run of letters: `TS-1854` → `TS`, `WO-22` → `WO`, `S-9` → `S`. */
export function leadingToken(billNumber: string): string {
  return /^([A-Za-z]+)/.exec(billNumber.trim())?.[1] ?? "";
}

/** Longest-prefix lookup. `ST-100` starts with `S`, so it routes to Sales. */
export function departmentsFor(token: string): Role[] {
  const t = token.trim().toUpperCase();
  if (!t) return [];
  return [...(ROUTES_BY_LENGTH.find((r) => t.startsWith(r.prefix))?.departments ?? [])];
}

/* ------------------------------------------------------------------ */
/* Branch routing — ADDITIVE, layered on top of BILL_ROUTES            */
/* ------------------------------------------------------------------ */

/**
 * A `W` that stands ALONE as a token, i.e. `W-038` or `IOM/BOG/W-038` but NOT
 * `WO-22` and NOT `WOCB-26`.
 *
 * A branch reference interleaves the branch, the company and the department code,
 * so the only reliable EID signal in `IOM/BOG/W-038` is a lone `W` followed by the
 * bill number. `WOCB-26` must not match — its `W` belongs to the `WO` token the
 * department rules already handle.
 */
const STANDALONE_W = /(?:^|[^A-Za-z0-9])W(?:[^A-Za-z0-9]|$)/;

export { matchBranch };

/**
 * The full routing decision for a reference. Additive by construction:
 *
 * 1. a branch prefix anywhere in the reference → `branches`, first so that
 *    `pendingBillHome()` (which reads `departments[0]`) links a saved bill to the
 *    branch register rather than to a department;
 * 2. `departmentsFor(leadingToken(...))` — the existing rules, UNCHANGED and
 *    always run, so nothing that routes today can move;
 * 3. a standalone `W` → `eid`, unless a department already said so.
 *
 * Every `BILL_ROUTES` entry is a single department, so today's results are at most
 * one element long and steps 1/3 can only ever append. A reference with no branch
 * prefix and no standalone `W` returns exactly `departmentsFor(leadingToken(…))`.
 */
export function routeReference(
  referenceNo: string,
  branches: readonly BranchRouteInput[] = []
): { departments: Role[]; branchId?: string; branchName?: string } {
  const trimmed = referenceNo.trim();
  const branch = matchBranch(trimmed, branches);
  const tokenSource = parseReferenceNo(trimmed).billNumber ?? trimmed;

  const departments: Role[] = [];
  if (branch) departments.push("branches");
  departments.push(...departmentsFor(leadingToken(tokenSource)));
  if (STANDALONE_W.test(trimmed) && !departments.includes("eid")) {
    departments.push("eid");
  }

  return {
    departments: [...new Set(departments)],
    branchId: branch?.id,
    branchName: branch?.name,
  };
}

/**
 * Escape a user-entered name for safe use inside a `new RegExp(...)`.
 *
 * A party name is free text typed by a user, and several queries match it with
 * `new RegExp("^" + name + "$", "i")` to find a bill by party. A name containing
 * regex metacharacters (`Acme (Pvt) Ltd.`) would otherwise be compiled as a
 * pattern — matching the wrong rows, or throwing on an unbalanced `(`.
 */
export function escapeRegex(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function routeLabel(departments: readonly Role[]): string {
  if (!departments.length) return "Accounts only (no matching prefix)";
  return departments.map((d) => ROLE_LABELS[d]).join(" + ");
}

const DAY_MS = 86_400_000;

const startOfDay = (d: Date | string): number => {
  const x = new Date(d);
  return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
};

/**
 * The bill's age in days: the gap from `billDate` to the due date, **plus** the
 * user's manual overdue days. That is the credit term followed by whatever
 * overdue period was typed, which is the number the register actually tracks.
 *
 * The gap is calendar days on local midnights, so it is stable within a day.
 *
 * **No due date** → there is no term to count, so the age falls back to whole
 * days from `billDate` to today. `overdueDays` is ignored in that case because it
 * is only meaningful once a bill has gone past its term.
 */
export function daysSinceBill(
  billDate: Date | string,
  dueOn?: Date | string | null,
  overdueDays = 0,
  now: Date = new Date()
): number {
  const from = startOfDay(billDate);

  if (dueOn) {
    return Math.round((startOfDay(dueOn) - from) / DAY_MS) + overdueDays;
  }

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((today - from) / DAY_MS);
}

/**
 * The bill's credit TERM in days: the gap from `billDate` to `dueOn`, on local
 * midnights so it is stable within a day — the same calendar-day arithmetic
 * `daysSinceBill` uses, without the manual overdue component.
 *
 * `null` means "no term": the bill carries no due date, so there is nothing to
 * count. Both lists read this one function (the Credit Term cell on Pending
 * Bills, and the range/override logic on Customers), so they can never disagree.
 */
export function creditTermDays(
  billDate: Date | string,
  dueOn?: Date | string | null
): number | null {
  if (!dueOn) return null;
  return Math.round((startOfDay(dueOn) - startOfDay(billDate)) / DAY_MS);
}

/**
 * The credit TERM to display for a PARTY, resolved with the same precedence
 * everywhere it is called:
 *
 * 1. The stored Credit Limit (Days) — a saved single number > 0, which wins
 *    over everything below even when a Min/Max override also exists.
 * 2. The manual Min/Max override (`termMinDays`/`termMaxDays`); Min only =
 *    a single number, Min + Max = the "7–30" spread.
 * 3. The range derived live from this party's OPEN bills (each bill's own
 *    `billDate → dueOn` gap — the same computation `creditTermDays` does).
 * 4. `null` = nothing to show; callers fall back to the bill's own per-bill
 *    term (Pending Bills) or render "—" (Customers).
 *
 * Callers choose whether level 3 applies: the **Customers list** passes
 * `billTermMin`/`billTermMax`; the **Pending Bills Credit Term column**
 * omits them, so a party without a stored term or override comes back `null`
 * and each bill shows its OWN individual gap instead of a party range.
 *
 * **A stored 0 is DISPLAY-skipped** — it falls through to the next level, the
 * same as absent. This applies to the display only: the sales-overdue maths
 * still treats `creditLimitDays = 0` as "due the day it was billed", and the
 * form still stores a typed 0.
 *
 * `min === max` means a single number. Pure and DB-free — callers pass the
 * numbers they already have.
 */
export function partyTermDays(c: {
  creditLimitDays?: number | null;
  termMinDays?: number | null;
  termMaxDays?: number | null;
  billTermMin?: number | null;
  billTermMax?: number | null;
}): { min: number; max: number } | null {
  if (c.creditLimitDays != null && c.creditLimitDays > 0) {
    return { min: c.creditLimitDays, max: c.creditLimitDays };
  }
  if (c.termMinDays != null && c.termMinDays > 0) {
    const max =
      c.termMaxDays != null && c.termMaxDays > 0 ? c.termMaxDays : c.termMinDays;
    return { min: c.termMinDays, max };
  }
  if (c.billTermMin != null && c.billTermMax != null) {
    return { min: c.billTermMin, max: c.billTermMax };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Ref. No. parsing — never throws, only reports                         */
/* ------------------------------------------------------------------ */

export type ParsedReference = {
  /** The part before `dt.`, e.g. `TS-1854`. Absent if nothing parses. */
  billNumber?: string;
  /** The date embedded in the reference, when it is a real calendar date. */
  embeddedDate?: Date;
  /**
   * A NON-BLOCKING problem. Parsing deliberately never rejects a save — an
   * unreadable reference is flagged in the UI, not refused.
   */
  issue?: string;
};

/**
 * `<anything> dt.<d>.<m>.<yyyy|yy>` anchored at both ends. Positional groups,
 * not named ones — the project's TS target predates ES2018 regex groups.
 * m[1]=number m[2]=day m[3]=month m[4]=year
 *
 * Supports two formats:
 * 1. "TS-1854 dt.14.3.2026" — traditional format
 * 2. "Mostafizur Rahman S-609 dt.15.9.2026" — party name + bill number format
 *    The bill number is extracted as the last occurrence of a known prefix pattern
 *    (TS, CW, WO, S, W followed by - and digits) before the dt. marker.
 */
const REF_RE = /^(.+?)\s*dt[:\.\s,]*(\d{1,2})[\/\.\-:, ]+(\d{1,2})[\/\.\-:, ]+(\d{2,4})\s*$/i;

/** Known department prefixes that identify a bill number. */
const BILL_PREFIX_PATTERN = /(?:^|\s)(TS|CW|WO|S|W)(-\d+)/gi;

/**
 * Extract the bill number from a reference string that may contain a party name.
 * Looks for the last occurrence of a known prefix pattern before the dt. marker.
 */
export function extractBillNumber(value: string): string | undefined {
  // Find the dt. position to limit search scope
  const dtIndex = value.toLowerCase().indexOf("dt");
  const searchArea = dtIndex >= 0 ? value.slice(0, dtIndex) : value;

  // Find all prefix-number patterns in the search area
  const matches = [...searchArea.matchAll(BILL_PREFIX_PATTERN)];
  if (matches.length > 0) {
    // Return the last match (closest to dt.)
    const lastMatch = matches[matches.length - 1];
    return (lastMatch[1] + lastMatch[2]).toUpperCase();
  }

  // Fallback: if no known prefix found, take the last word-like token before dt.
  const tokens = searchArea.trim().split(/\s+/);
  return tokens.length > 0 ? tokens[tokens.length - 1] : undefined;
}

/**
 * Split a composite Ref. No. into bill number + date.
 *
 * @example parseReferenceNo("TS-1854 dt.14.3.2026")
 * // → { billNumber: "TS-1854", embeddedDate: 2026-03-14 }
 * @example parseReferenceNo("Mostafizur Rahman S-609 dt.15.9.2026")
 * // → { billNumber: "S-609", embeddedDate: 2026-09-15 }
 * @example parseReferenceNo("TS-1854 dt.32.13.2026")
 * // → { billNumber: "TS-1854", issue: "… is not a real calendar date." }
 * @example parseReferenceNo("TS-1854")
 * // → { billNumber: "TS-1854", issue: "… has no `dt.D.M.YYYY` date." }
 */
export function parseReferenceNo(raw: string): ParsedReference {
  const value = raw.trim();
  if (!value) return { issue: "Reference number is empty." };

  const m = REF_RE.exec(value);
  if (!m) {
    // No `dt.` marker at all → try to extract bill number from the whole string
    const billNumber = extractBillNumber(value);
    if (billNumber) return { billNumber, issue: "Ref. no. has no `dt.D.M.YYYY` date." };
    return { issue: "Ref. no. has no `dt.D.M.YYYY` date." };
  }

  const [, rawNum, d, mo, y] = m;
  // Extract bill number from the part before dt. (which may include party name)
  const billNumber = extractBillNumber(rawNum) ?? rawNum.trim();
  if (!billNumber) return { issue: "Ref. no. has no bill number before `dt.`." };

  const year = y.length === 2 ? 2000 + Number(y) : Number(y);
  const day = Number(d);
  const month = Number(mo);
  const date = new Date(year, month - 1, day);

  // Round-trip guard: `new Date(2026, 1, 31)` silently rolls into March, so read
  // the components back rather than trusting the constructor. This is also what
  // catches month 0 / 13.
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return {
      billNumber,
      issue: `Ref. no. date ${d}.${mo}.${y} is not a real calendar date.`,
    };
  }

  return { billNumber, embeddedDate: date };
}

/**
 * The single derivation every write path calls. `billNumber`, `departments` and
 * the branch link are never accepted from a form or a spreadsheet — they are
 * always recomputed here, so they cannot drift from `referenceNo`.
 *
 * When a reference carries no `dt.` date the whole string is used for prefix
 * matching, so `TS-99` still routes to Consumable.
 *
 * `branches` is omitted by the READ path on purpose. `selectPendingBills` and
 * `billWarnings` re-derive for legacy rows that have no stored `departments`, and
 * giving them the branch list would make a row *display* "Routed To: Branches"
 * while the list scope — a real `{ departments: "branches" }` match, which Mongo
 * cannot evaluate against a computed value — left it out of `/branches`. Passing
 * the list is therefore a write-path-only decision.
 *
 * @param preResolvedDepartments - Optional departments from mapping DB lookup (server-side only)
 */
export function deriveFromReference(
  referenceNo: string,
  branches: readonly BranchRouteInput[] = [],
  preResolvedDepartments?: Role[]
): {
  referenceNo: string;
  billNumber?: string;
  departments: Role[];
  branchId?: string;
  branchName?: string;
} {
  const referenceNoTrimmed = referenceNo.trim();
  const parsed = parseReferenceNo(referenceNoTrimmed);
  const routed = routeReference(referenceNoTrimmed, branches);
  return {
    referenceNo: referenceNoTrimmed,
    billNumber: parsed.billNumber,
    departments: preResolvedDepartments ?? routed.departments,
    branchId: routed.branchId,
    branchName: routed.branchName,
  };
}

/* ------------------------------------------------------------------ */
/* Warnings (recomputed at render time so they can never go stale)      */
/* ------------------------------------------------------------------ */

export type WarnableBill = {
  referenceNo: string;
  billDate: Date | string;
  departments?: Role[];
};

/**
 * Advisory problems with a row, as amber pills in the list. Col A (billDate)
 * stays authoritative for the bill date; the date inside the reference is a
 * cross-check, so a disagreement is reported rather than resolved.
 */
export function billWarnings(bill: WarnableBill): string[] {
  const out: string[] = [];
  const parsed = parseReferenceNo(bill.referenceNo);

  if (parsed.issue) {
    out.push(parsed.issue);
  } else if (
    parsed.embeddedDate &&
    toDateInput(parsed.embeddedDate) !== toDateInput(bill.billDate)
  ) {
    out.push(
      `Ref. date ${formatDate(parsed.embeddedDate)} ≠ bill date ${formatDate(bill.billDate)}`
    );
  }

  const departments = bill.departments?.length
    ? bill.departments
    : deriveFromReference(bill.referenceNo).departments;
  if (!departments.length) {
    const token = leadingToken(parsed.billNumber ?? bill.referenceNo);
    out.push(
      token
        ? `No department matches "${token}" — shows in Accounts only`
        : `No bill number to route on — shows in Accounts only`
    );
  }

  return out;
}

/** Read-time display value: the stored number, or a re-parse for legacy rows. */
export function displayBillNumber(bill: { billNumber?: string; referenceNo: string }): string {
  return bill.billNumber ?? parseReferenceNo(bill.referenceNo).billNumber ?? "";
}

/**
 * Client-side department resolution (auto-detection only, no DB).
 * Used for live hints in the form.
 */
export function resolveDepartmentsAuto(
  referenceNo: string,
  branches: readonly BranchRouteInput[] = []
): ResolvedDepartments {
  const parsed = parseReferenceNo(referenceNo);
  const billNumber = parsed.billNumber ?? referenceNo.trim();
  const routed = routeReference(referenceNo, branches);
  return {
    departments: routed.departments,
    source: "auto",
    billNumber,
  };
}

/* ------------------------------------------------------------------ */
/* Validation shared by the form action and the importer                */
/* ------------------------------------------------------------------ */

export type BillInput = {
  billDate: string;
  referenceNo: string;
  partyName: string;
  openingAmount: number;
  pendingAmount: number;
  dueOn: string;
  overdueDays: number;
  note: string;
};

/** Hard failures only — these are the cases a row is skipped for. */
export function validateBillInput(f: BillInput): string | null {
  if (!f.billDate) return "Bill date is required.";
  if (Number.isNaN(new Date(f.billDate).getTime())) return "Bill date is invalid.";
  if (!f.referenceNo) return "Reference number is required.";
  if (!f.partyName) return "Party's name is required.";
  if (!Number.isFinite(f.openingAmount) || f.openingAmount < 0) {
    return "Opening amount must be zero or a positive number.";
  }
  if (!Number.isFinite(f.pendingAmount) || f.pendingAmount < 0) {
    return "Pending amount must be zero or a positive number.";
  }
  if (f.openingAmount > 0 && f.pendingAmount > f.openingAmount) {
    return "Pending amount cannot be greater than the opening amount.";
  }
  if (f.dueOn && Number.isNaN(new Date(f.dueOn).getTime())) {
    return "Due date is invalid.";
  }
  if (!Number.isInteger(f.overdueDays) || f.overdueDays < 0) {
    return "Overdue days must be zero or a whole number of days.";
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Excel column map — drives the export writer and the import matcher   */
/* ------------------------------------------------------------------ */

export type PendingBillColumn = {
  letter: string;
  header: string;
  field: keyof BillInput;
  width: number;
  format: "date" | "text" | "amount" | "int";
  help: string;
};

export const PENDING_BILL_COLUMNS: readonly PendingBillColumn[] = [
  {
    letter: "A",
    header: "Date",
    field: "billDate",
    width: 14,
    format: "date",
    help: "Col A — the date on the invoice or bill. Required.",
  },
  {
    letter: "B",
    header: "Ref. No.",
    field: "referenceNo",
    width: 28,
    format: "text",
    help: "Col B — the WHOLE string, e.g. `TS-1854 dt.14.3.2026`. Required. The bill number and date are read out of it. TS → Consumable, WO → EID + ESBD, S → Sales.",
  },
  {
    letter: "C",
    header: "Party's Name",
    field: "partyName",
    width: 26,
    format: "text",
    help: "Col C — free-text party name. Required.",
  },
  {
    letter: "D",
    header: "Opening Amount",
    field: "openingAmount",
    width: 16,
    format: "amount",
    help: "Col D — the bill amount when it was opened. Required, 0 or more.",
  },
  {
    letter: "E",
    header: "Pending Amount",
    field: "pendingAmount",
    width: 16,
    format: "amount",
    help: "Col E — still unpaid. Required, 0 or more, and never more than the opening amount. A 0 row is saved but hidden from the list.",
  },
  {
    letter: "F",
    header: "Due on",
    field: "dueOn",
    width: 14,
    format: "date",
    help: "Col F — optional payment due date. Leave blank for no term.",
  },
  {
    letter: "G",
    header: "Overdue by days",
    field: "overdueDays",
    width: 17,
    format: "int",
    help: "Col G — whole days overdue, which YOU type. Blank or 0 means not yet due. Never calculated from Due on.",
  },
  {
    letter: "H",
    header: "Note",
    field: "note",
    width: 30,
    format: "text",
    help: "Col H — optional remarks.",
  },
];

/** Accepted spellings per column, compared after `normalizeHeader`. */
const HEADER_ALIASES: Record<keyof BillInput, readonly string[]> = {
  billDate: ["date", "bill date", "invoice date", "col a", "a", "date invoice bill date"],
  referenceNo: [
    "ref no",
    "ref",
    "reference",
    "reference no",
    "reference number",
    "ref no reference voucher number",
    "col b",
    "b",
  ],
  partyName: [
    "party",
    "party name",
    "party s name",
    "customer",
    "client",
    "col c",
    "c",
  ],
  openingAmount: [
    "opening",
    "opening amount",
    "opening bill amount",
    "col d",
    "d",
  ],
  pendingAmount: [
    "pending",
    "pending amount",
    "outstanding",
    "col e",
    "e",
  ],
  dueOn: ["due", "due date", "due on", "payment due date", "col f", "f"],
  overdueDays: [
    "overdue",
    "overdue days",
    "overdue by days",
    "aging",
    "col g",
    "g",
  ],
  note: ["note", "notes", "remark", "remarks", "col h", "h"],
};

function aliasesFor(field: keyof BillInput): readonly string[] {
  return HEADER_ALIASES[field];
}

/** "Ref. No." / "ref no" / "REF_NO" all collapse to the same key. */
export function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Map a sheet's header row onto columns, index-aligned with `headers` so
 * `result[i]` is the column read from sheet column `i` (null = ignore it).
 * `byName` reports whether any header matched by name, which is what decides
 * whether positional A–H fallback is used at all.
 */
export function matchColumnsDetailed(headers: string[]): {
  byName: boolean;
  columns: (PendingBillColumn | null)[];
} {
  const norm = headers.map((h) => normalizeHeader(h));
  const result: (PendingBillColumn | null)[] = PENDING_BILL_COLUMNS.map(() => null);
  const taken = new Set<number>();

  // Strongest (longest) alias first so "ref no" beats a bare "ref".
  const candidates = PENDING_BILL_COLUMNS.map((col, index) => ({
    index,
    aliases: aliasesFor(col.field),
  })).sort((a, b) => maxAlias(b.aliases) - maxAlias(a.aliases));

  for (let i = 0; i < norm.length; i++) {
    const h = norm[i];
    if (!h) continue;

    let best: number | null = null;
    let bestScore = 0;
    for (const { index, aliases } of candidates) {
      if (taken.has(index)) continue;
      let score = 0;
      for (const a of aliases) {
        if (h === a) score = Math.max(score, 1000 + a.length);
        // Containment only for aliases long enough to be unambiguous — a bare
        // "a" would otherwise match "opening amount".
        else if (a.length >= 3 && h.includes(a)) score = Math.max(score, 100 + a.length);
      }
      if (score > bestScore) {
        bestScore = score;
        best = index;
      }
    }
    if (best !== null && bestScore > 0) {
      result[i] = PENDING_BILL_COLUMNS[best];
      taken.add(best);
    }
  }

  if (result.some(Boolean)) return { byName: true, columns: result };

  // Not a single recognisable header — trust the documented A–H order.
  return {
    byName: false,
    columns: PENDING_BILL_COLUMNS.map((col, i) => (i < norm.length ? col : null)),
  };
}

function maxAlias(aliases: readonly string[]): number {
  return aliases.reduce((m, a) => Math.max(m, a.length), 0);
}

/* ------------------------------------------------------------------ */
/* Spreadsheet value coercion                                          */
/* ------------------------------------------------------------------ */

/**
 * Excel hands back a `Date` for a date-formatted cell, but text and serial
 * numbers show up constantly once a file has been re-typed. Returns `yyyy-mm-dd`
 * (the shape the form + model both use) or null when it is not a real date.
 */
export function parseDateValue(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;

  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : toDateInput(v);
  }

  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 1) return null;
    // Excel serial 0 is 1899-12-30 (the 1900 leap-year bug). Built in UTC and
    // read back with getUTC* so a timezone can never shift the day.
    const d = new Date(Date.UTC(1899, 11, 30 + Math.floor(v)));
    return Number.isNaN(d.getTime()) ? null : utcDateInput(d);
  }

  const s = String(v).trim();
  if (!s) return null;

  // Unambiguous numeric dates are day-first: 14.03.2026 and 03/14/2026 are read
  // as 14 March either way, which is why we never guess month-first.
  const dmy = /^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/.exec(s);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
    const d = new Date(year, month - 1, day);
    if (
      d.getFullYear() === year &&
      d.getMonth() === month - 1 &&
      d.getDate() === day
    ) {
      return toDateInput(d);
    }
    return null;
  }

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : toDateInput(d);
}

function utcDateInput(d: Date): string {
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${m}-${day}`;
}

/** Tolerates `৳1,234.50`, `1234.5` and numeric cells alike. */
export function parseAmount(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[৳,%\s]/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseIntValue(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * Identity used by the Excel importer: **bill number + party**, not the whole
 * reference. Correcting the embedded date (`dt.14.3.2026` → `dt.15.3.2026`)
 * therefore updates the same bill instead of forking a second one. Falls back
 * to the full reference when no bill number parses, so nothing is unmatchable.
 */
export function pendingBillKey(referenceNo: string, partyName: string): string {
  const parsed = parseReferenceNo(referenceNo);
  const id = (parsed.billNumber ?? referenceNo).trim().toLowerCase();
  return `${id}::${partyName.trim().toLowerCase()}`;
}

/** Rebuilds the export `href` so a download matches what the list is showing. */
export function toExportQueryString(params: Record<string, string | string[] | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "string" && v !== "") sp.set(k, v);
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}
