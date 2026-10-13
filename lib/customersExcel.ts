/**
 * Excel transfer for the Customers register — SERVER ONLY.
 *
 * The layout is driven entirely by `CUSTOMER_COLUMNS`, so the export writer,
 * the header matcher and the "How to fill" sheet can never disagree about what
 * a column is. Ten columns, mirroring the customer form field for field.
 *
 * There is deliberately NO approval column: `approvalStatus` is never writable
 * by an import (same rule as `updateCustomer`), so a round-trip export → edit →
 * import can neither grant nor revoke an approval by accident.
 */

import ExcelJS from "exceljs";
import type { CustomerCreditRow } from "@/lib/credit";
import {
  IMPORT_MAX_ROWS,
  normalizeHeader,
  parseIntValue,
} from "@/lib/pendingBills";
import { DEFAULT_CUSTOMER_GROUP } from "@/lib/types";

export const CUSTOMER_SHEET = "Customers";
export const HOW_TO_FILL_SHEET = "How to fill";

/* ------------------------------------------------------------------ */
/* Column map — drives the writer, the matcher and the help sheet      */
/* ------------------------------------------------------------------ */

export type CustomerInput = {
  name: string;
  category: string;
  group: string;
  address: string;
  contactPerson: string;
  contactNumber: string;
  branch: string;
  /** `null` = blank cell = automatic term, exactly like leaving the form box empty. */
  creditLimitDays: number | null;
  termMinDays: number | null;
  termMaxDays: number | null;
};

export type CustomerColumn = {
  letter: string;
  header: string;
  field: keyof CustomerInput;
  width: number;
  format: "text" | "int";
  help: string;
};

export const CUSTOMER_COLUMNS: readonly CustomerColumn[] = [
  {
    letter: "A",
    header: "Customer Name",
    field: "name",
    width: 32,
    format: "text",
    help: "Col A — the customer / company name, spelled exactly as it should appear everywhere. Required. Names are unique (matched case-insensitively).",
  },
  {
    letter: "B",
    header: "Category",
    field: "category",
    width: 16,
    format: "text",
    help: "Col B — optional. Retail / Wholesale / Corporate / Government / Distributor / Other (see Manage Dropdowns).",
  },
  {
    letter: "C",
    header: "Group",
    field: "group",
    width: 26,
    format: "text",
    help: `Col C — optional group of companies. Blank is skipped: an existing customer keeps its group, a new one gets "${DEFAULT_CUSTOMER_GROUP}".`,
  },
  {
    letter: "D",
    header: "Address",
    field: "address",
    width: 32,
    format: "text",
    help: "Col D — optional address.",
  },
  {
    letter: "E",
    header: "Contact Person",
    field: "contactPerson",
    width: 22,
    format: "text",
    help: "Col E — optional contact person's name. A cell holding only 0 is treated as empty and skipped, so it never replaces a real name.",
  },
  {
    letter: "F",
    header: "Contact Number",
    field: "contactNumber",
    width: 18,
    format: "text",
    help: "Col F — optional phone number. Keep the cell as text so leading zeros survive. A cell holding only 0 (or blank) is skipped — it never becomes a contact number.",
  },
  {
    letter: "G",
    header: "Branch",
    field: "branch",
    width: 16,
    format: "text",
    help: "Col G — optional branch (see Manage Dropdowns).",
  },
  {
    letter: "H",
    header: "Credit Limit (Days)",
    field: "creditLimitDays",
    width: 18,
    format: "int",
    help: "Col H — the payment term in DAYS this customer gets to pay. Blank or 0 is SKIPPED: the stored term is never overwritten, so you can fill in only the rows you want to change.",
  },
  {
    letter: "I",
    header: "Term Min (Days)",
    field: "termMinDays",
    width: 16,
    format: "int",
    help: "Col I — optional manual override, lower bound. Blank or 0 is skipped (stored value kept). On its own it pins a single number; with Col J it pins a range that later imports cannot move.",
  },
  {
    letter: "J",
    header: "Term Max (Days)",
    field: "termMaxDays",
    width: 16,
    format: "int",
    help: "Col J — optional manual override, upper bound. Blank or 0 is skipped (stored value kept). Leave both I and J blank to keep whatever term the customer already has.",
  },
];

/** Accepted spellings per column, compared after `normalizeHeader`. */
const HEADER_ALIASES: Record<keyof CustomerInput, readonly string[]> = {
  name: [
    "customer name",
    "company name",
    "name",
    "customer",
    "company",
    "party name",
    "party",
    "col a",
    "a",
  ],
  category: ["category", "type", "col b", "b"],
  group: ["group", "group of company", "group of companies", "col c", "c"],
  address: ["address", "addr", "col d", "d"],
  contactPerson: ["contact person", "contact person name", "person", "col e", "e"],
  contactNumber: [
    "contact number",
    "phone",
    "phone number",
    "mobile",
    "contact no",
    "col f",
    "f",
  ],
  branch: ["branch", "location", "col g", "g"],
  creditLimitDays: [
    "credit limit days",
    "credit limit",
    "credit term",
    "term days",
    "terms days",
    "payment term",
    "col h",
    "h",
  ],
  termMinDays: ["term min days", "term min", "min days", "term override min", "col i", "i"],
  termMaxDays: ["term max days", "term max", "max days", "term override max", "col j", "j"],
};

function aliasesFor(field: keyof CustomerInput): readonly string[] {
  return HEADER_ALIASES[field];
}

/** "Contact Number" / "contact no" / "CONTACT_NO" all collapse to one key. */
function matchColumnsDetailed(headers: string[]): {
  byName: boolean;
  columns: (CustomerColumn | null)[];
} {
  const norm = headers.map((h) => normalizeHeader(h));
  const result: (CustomerColumn | null)[] = CUSTOMER_COLUMNS.map(() => null);
  const taken = new Set<number>();

  const candidates = CUSTOMER_COLUMNS.map((col, index) => ({
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
        // "a" would otherwise match "address".
        else if (a.length >= 3 && h.includes(a)) score = Math.max(score, 100 + a.length);
      }
      if (score > bestScore) {
        bestScore = score;
        best = index;
      }
    }
    if (best !== null && bestScore > 0) {
      result[i] = CUSTOMER_COLUMNS[best];
      taken.add(best);
    }
  }

  if (result.some(Boolean)) return { byName: true, columns: result };

  // Not a single recognisable header — trust the documented A–J order.
  return {
    byName: false,
    columns: CUSTOMER_COLUMNS.map((col, i) => (i < norm.length ? col : null)),
  };
}

function maxAlias(aliases: readonly string[]): number {
  return aliases.reduce((m, a) => Math.max(m, a.length), 0);
}

/**
 * Hard failures only — these are what skip a row. Mirrors the rules
 * `createCustomer` / `updateCustomer` enforce, so an import can never write a
 * row the form would have rejected.
 */
export function validateCustomerInput(f: CustomerInput): string | null {
  if (!f.name.trim()) return "Customer name is required.";

  const days = (v: number | null, label: string): string | null => {
    if (v === null) return null;
    if (!Number.isInteger(v) || v < 0) return `${label} must be whole days of 0 or more.`;
    return null;
  };

  for (const [v, label] of [
    [f.creditLimitDays, "Credit Limit (Days)"],
    [f.termMinDays, "Term Min (Days)"],
    [f.termMaxDays, "Term Max (Days)"],
  ] as const) {
    const err = days(v, label);
    if (err) return err;
  }

  if (f.termMaxDays !== null && f.termMinDays === null) {
    return "Term override: enter Term Min days, or leave BOTH Min and Max blank to keep the term automatic.";
  }
  if (f.termMinDays !== null && f.termMaxDays !== null && f.termMaxDays < f.termMinDays) {
    return `Term override: Max (${f.termMaxDays}) cannot be smaller than Min (${f.termMinDays}).`;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

export function buildCustomerWorkbook(
  rows: readonly CustomerCreditRow[],
  opts: { template?: boolean } = {}
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Credit Control Daily";
  wb.created = new Date();

  const ws = wb.addWorksheet(CUSTOMER_SHEET, {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  ws.addRow(CUSTOMER_COLUMNS.map((c) => c.header));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4338CA" } };
  head.alignment = { vertical: "middle" };
  head.height = 22;
  CUSTOMER_COLUMNS.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width;
  });

  if (!opts.template) {
    for (const r of rows) {
      const values = CUSTOMER_COLUMNS.map((c) => {
        switch (c.field) {
          case "category":
            return r.category ?? "";
          case "group":
            return r.group ?? "";
          case "address":
            return r.address ?? "";
          case "contactPerson":
            return r.contactPerson ?? "";
          case "contactNumber":
            return r.contactNumber ?? "";
          case "branch":
            return r.branch ?? "";
          case "creditLimitDays":
            // The STORED value, never the `?? 30` display fallback — a blank
            // cell must round-trip back to "automatic".
            return r.rawCreditLimitDays ?? "";
          case "termMinDays":
            return r.termMinDays ?? "";
          case "termMaxDays":
            return r.termMaxDays ?? "";
          default:
            return r.name;
        }
      });
      const row = ws.addRow(values);
      CUSTOMER_COLUMNS.forEach((c, i) => {
        if (c.format === "int") row.getCell(i + 1).numFmt = "0";
      });
    }
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: CUSTOMER_COLUMNS.length },
    };
  }

  addHowToFillSheet(wb);
  return wb;
}

function addHowToFillSheet(wb: ExcelJS.Workbook): void {
  const ws = wb.addWorksheet(HOW_TO_FILL_SHEET);
  ws.getColumn(1).width = 20;
  ws.getColumn(2).width = 100;

  const title = ws.addRow(["How to fill this sheet"]);
  title.font = { bold: true, size: 14 };

  ws.addRow([]);
  const intro = ws.addRow([
    "One row per customer",
    "Only Col A (Customer Name) is required. Every other column is optional and can be left blank.",
  ]);
  intro.getCell(2).font = { bold: true };

  ws.addRow([]);
  const matching = ws.addRow([
    "Matching",
    "Rows are matched to existing customers by NAME, ignoring case: ACME Ltd and acme ltd are the same customer.",
  ]);
  matching.getCell(2).font = { bold: true };
  ws.addRow([
    "",
    "• An existing customer has its details updated in place — its approval status is NEVER changed by an import.",
  ]);
  ws.addRow([
    "",
    "• A name that matches nobody is created as a NEW customer, waiting for admin approval (same as Add Customer).",
  ]);
  ws.addRow([
    "",
    "• EMPTY or 0 cells are SKIPPED, never written: an empty Contact Person / Contact Number / Branch / Group / term column leaves whatever is already stored untouched (a contact cell holding only 0 counts as empty). The two contact columns are skipped independently, so a row with person 0 but a real number saves the number and leaves the person alone. Only a filled-in cell replaces a value, so an export can be edited row by row and re-imported safely.",
  ]);
  ws.addRow(["", "• A name appearing twice in the file is imported once and the second row is reported."]);
  ws.addRow(["", "• Bad rows are skipped and reported; the good rows are still imported."]);

  ws.addRow([]);
  const head = ws.addRow(["Column", "What goes in it"]);
  head.font = { bold: true };

  for (const col of CUSTOMER_COLUMNS) {
    ws.addRow([`${col.letter} — ${col.header}`, col.help]);
  }

  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    row.getCell(1).font = row.getCell(1).font?.bold ? row.getCell(1).font : { bold: true };
    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
  }
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

export type ParsedCustomerRow = {
  /** 1-based row number in the sheet, so messages point at the real cell. */
  rowNumber: number;
  /** Customer name as read, for the message text. */
  label: string;
  /** A HARD failure — this row is skipped. */
  error?: string;
  /** Advisory only — the row is still imported. */
  warnings: string[];
  input?: CustomerInput;
};

export type ParsedCustomerImport = {
  rows: ParsedCustomerRow[];
  /** Rows dropped because every mapped cell was blank. */
  blankRows: number;
  /** Human note about how the columns were resolved. */
  mappingNote: string;
};

/** Flatten every shape ExcelJS can hand back into a usable value. */
function cellValue(cell: ExcelJS.Cell): unknown {
  const v: unknown = cell.value;
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (o.result !== undefined && o.result !== null) return o.result;
    if (Array.isArray(o.richText)) {
      return (o.richText as { text?: string }[]).map((t) => t.text ?? "").join("");
    }
    if (o.text !== undefined) return o.text;
    if (o.error !== undefined) return null;
  }
  return v;
}

function cellText(cell: ExcelJS.Cell): string {
  const v = cellValue(cell);
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

function findHeaderRow(ws: ExcelJS.Worksheet): number {
  const limit = Math.min(ws.rowCount, 10);
  for (let r = 1; r <= limit; r++) {
    const row = ws.getRow(r);
    const names = range(1, ws.columnCount).map((c) => row.getCell(c).text ?? "");
    if (names.some((n) => n.trim() !== "") && matchColumnsDetailed(names).byName) return r;
  }
  return 1;
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

export async function readCustomerWorkbook(buffer: ArrayBuffer): Promise<ParsedCustomerImport> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new Error("That file could not be read as an .xlsx workbook.");
  }

  const ws =
    wb.getWorksheet(CUSTOMER_SHEET) ??
    wb.worksheets.find((s) => s.name !== HOW_TO_FILL_SHEET) ??
    wb.worksheets[0];
  if (!ws) throw new Error("That workbook has no sheet to read.");

  const headerRow = findHeaderRow(ws);
  const headerRowValues = ws.getRow(headerRow);
  const headerNames = range(1, ws.columnCount).map(
    (c) => headerRowValues.getCell(c).text ?? ""
  );

  const { byName, columns } = matchColumnsDetailed(headerNames);
  const mappingNote = byName
    ? headerRow === 1
      ? "Columns matched by header name."
      : `Columns matched by header name (header row ${headerRow}).`
    : "No header names recognised — columns were read positionally as A–J.";

  const found = new Map<string, number>();
  columns.forEach((col: CustomerColumn | null, i) => {
    if (col && !found.has(col.field)) found.set(col.field, i + 1);
  });

  if (!found.has("name")) {
    throw new Error(
      "The sheet is missing the required Customer Name column. Download the template and paste your data under its headers."
    );
  }

  const cellAt = (row: ExcelJS.Row, field: keyof CustomerInput): ExcelJS.Cell => {
    const col = found.get(field);
    return row.getCell(col ?? 1);
  };

  const rows: ParsedCustomerRow[] = [];
  let blankRows = 0;

  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    // A row with nothing in any mapped cell is padding, not a bad customer.
    if (CUSTOMER_COLUMNS.every((c) => isBlank(cellValue(cellAt(row, c.field))))) {
      blankRows++;
      continue;
    }

    if (rows.length >= IMPORT_MAX_ROWS) {
      throw new Error(
        `That sheet has more than ${IMPORT_MAX_ROWS} data rows. Split it into smaller files and import them one at a time.`
      );
    }

    const name = cellText(cellAt(row, "name"));
    const label = name || `row ${r}`;

    const readDays = (field: keyof CustomerInput): { value: number | null; error?: string } => {
      const raw = cellValue(cellAt(row, field));
      if (isBlank(raw)) return { value: null };
      const parsed = parseIntValue(raw);
      if (parsed === null) {
        return {
          value: null,
          error: `${headerOf(field)} is not a whole number of days (${cellText(cellAt(row, field))}).`,
        };
      }
      return { value: parsed };
    };

    const credit = readDays("creditLimitDays");
    const min = readDays("termMinDays");
    const max = readDays("termMaxDays");
    const dayError = credit.error ?? min.error ?? max.error;

    const input: CustomerInput = {
      name,
      category: cellText(cellAt(row, "category")),
      group: cellText(cellAt(row, "group")),
      address: cellText(cellAt(row, "address")),
      contactPerson: cellText(cellAt(row, "contactPerson")),
      contactNumber: cellText(cellAt(row, "contactNumber")),
      branch: cellText(cellAt(row, "branch")),
      creditLimitDays: credit.value,
      termMinDays: min.value,
      termMaxDays: max.value,
    };

    const error = dayError ?? validateCustomerInput(input);
    if (error) {
      rows.push({ rowNumber: r, label, error, warnings: [] });
      continue;
    }

    rows.push({ rowNumber: r, label, warnings: [], input });
  }

  return { rows, blankRows, mappingNote };
}

function headerOf(field: keyof CustomerInput): string {
  return CUSTOMER_COLUMNS.find((c) => c.field === field)?.header ?? field;
}
