/**
 * Excel transfer for the Pending Bills register — SERVER ONLY.
 *
 * The workbook layout is driven entirely by `PENDING_BILL_COLUMNS`, so the export
 * writer, the header matcher and the "How to fill" sheet can never disagree about
 * what a column is. There is no bill-number column by design: the bill number and
 * the bill date are read out of the composite Ref. No. string.
 */

import ExcelJS from "exceljs";
import type { Role } from "@/lib/types";
import {
  BILL_ROUTES,
  IMPORT_MAX_ROWS,
  PENDING_BILL_COLUMNS,
  billWarnings,
  matchColumnsDetailed,
  parseAmount,
  parseDateValue,
  parseIntValue,
  routeLabel,
  validateBillInput,
  type BillInput,
  type PendingBillColumn,
} from "@/lib/pendingBills";
import type { PendingBillRow } from "@/lib/pendingBillsData";

export const PENDING_BILL_SHEET = "Pending Bills";
export const HOW_TO_FILL_SHEET = "How to fill";

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

export function buildWorkbook(
  rows: readonly PendingBillRow[],
  opts: { template?: boolean } = {}
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Credit Control Daily";
  wb.created = new Date();

  const ws = wb.addWorksheet(PENDING_BILL_SHEET, {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  const headers = PENDING_BILL_COLUMNS.map((c) => c.header);
  ws.addRow(headers);
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4338CA" } };
  head.alignment = { vertical: "middle" };
  head.height = 22;
  PENDING_BILL_COLUMNS.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width;
  });

  if (!opts.template) {
    for (const r of rows) {
      const values = PENDING_BILL_COLUMNS.map((c) => {
        switch (c.field) {
          case "billDate":
            return r.billDate;
          case "dueOn":
            return r.dueOn ?? "";
          case "overdueDays":
            return r.overdueDays > 0 ? r.overdueDays : "";
          case "openingAmount":
          case "pendingAmount":
            return r[c.field];
          default:
            return r[c.field];
        }
      });
      const row = ws.addRow(values);
      const dateCols: number[] = [];
      const amountCols: number[] = [];
      PENDING_BILL_COLUMNS.forEach((c, i) => {
        if (c.format === "date") dateCols.push(i + 1);
        if (c.format === "amount" || c.format === "int") amountCols.push(i + 1);
      });
      for (const i of dateCols) row.getCell(i).numFmt = "dd-mmm-yyyy";
      for (const i of amountCols) row.getCell(i).numFmt = "#,##0.00";
    }
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: PENDING_BILL_COLUMNS.length },
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
    "Ref. No.",
    "Paste the WHOLE reference into one cell, exactly as your source gives it:  <bill number> dt.<day>.<month>.<year>   e.g.   TS-1854 dt.14.3.2026",
  ]);
  intro.getCell(2).font = { bold: true };

  ws.addRow([]);
  const routing = ws.addRow(["Routing", "The bill number decides which app the bill appears in:"]);
  routing.getCell(2).font = { bold: true };
  for (const route of BILL_ROUTES) {
    ws.addRow([
      route.prefix,
      `starts with "${route.prefix}"  →  ${route.label}  (${route.departments.join(" + ")})`,
    ]);
  }
  ws.addRow([
    "anything else",
    "No matching prefix — the bill is kept in Accounts only and flagged with a warning so you can correct it.",
  ]);

  ws.addRow([]);
  ws.addRow([
    "Import rules",
    "• A row is matched to an existing bill by BILL NUMBER + PARTY, so correcting the date inside the reference updates the same bill instead of creating a second one.",
    "",
  ]);
  ws.addRow(["", "• Bad rows are skipped and reported; the good rows are still imported."]);
  ws.addRow(["", "• The bill number is re-read from Ref. No. on import, so editing the cell cannot corrupt it."]);
  ws.addRow(["", "• Overdue by days is YOUR figure — it is never recalculated from Due on."]);
  ws.addRow(["", "• A row with Pending Amount 0 is saved but stays hidden from the list."]);

  ws.addRow([]);
  const head = ws.addRow(["Column", "What goes in it"]);
  head.font = { bold: true };

  for (const col of PENDING_BILL_COLUMNS) {
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

export type ParsedImportRow = {
  /** 1-based row number in the sheet, so messages point at the real cell. */
  rowNumber: number;
  /** Ref. No. as read, for the message text. */
  label: string;
  /** A HARD failure — this row is skipped. */
  error?: string;
  /** Advisory only — the row is still imported. */
  warnings: string[];
  input?: BillInput;
};

export type ParsedImport = {
  rows: ParsedImportRow[];
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

/** Locate the header row: the first of the first 10 rows with a recognisable name. */
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

export async function readWorkbook(buffer: ArrayBuffer): Promise<ParsedImport> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new Error("That file could not be read as an .xlsx workbook.");
  }

  const ws =
    wb.getWorksheet(PENDING_BILL_SHEET) ??
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
    : "No header names recognised — columns were read positionally as A–H.";

  const found = new Map<string, number>();
  columns.forEach((col: PendingBillColumn | null, i) => {
    if (col && !found.has(col.field)) found.set(col.field, i + 1);
  });

  const REQUIRED: (keyof BillInput)[] = [
    "billDate",
    "referenceNo",
    "partyName",
    "openingAmount",
    "pendingAmount",
  ];
  const missing = REQUIRED.filter((f) => !found.has(f));
  if (missing.length) {
    const names = missing
      .map((f) => PENDING_BILL_COLUMNS.find((c) => c.field === f)?.header ?? f)
      .join(", ");
    throw new Error(`The sheet is missing required column(s): ${names}. Download the template and paste your data under its headers.`);
  }

  const cellAt = (row: ExcelJS.Row, field: keyof BillInput): ExcelJS.Cell => {
    const col = found.get(field);
    return row.getCell(col ?? 1);
  };

  const rows: ParsedImportRow[] = [];
  let blankRows = 0;

  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    // A row with nothing in any required column is padding, not a bad bill.
    if (REQUIRED.every((f) => isBlank(cellValue(cellAt(row, f))))) {
      blankRows++;
      continue;
    }

    if (rows.length >= IMPORT_MAX_ROWS) {
      throw new Error(
        `That sheet has more than ${IMPORT_MAX_ROWS} data rows. Split it into smaller files and import them one at a time.`
      );
    }

    const referenceNo = cellText(cellAt(row, "referenceNo"));
    const label = referenceNo || `row ${r}`;

    const billDateRaw = cellValue(cellAt(row, "billDate"));
    const billDate = parseDateValue(billDateRaw);
    const dueOnRaw = cellValue(cellAt(row, "dueOn"));
    const dueOn = parseDateValue(dueOnRaw);
    const openingRaw = cellValue(cellAt(row, "openingAmount"));

    const input: BillInput = {
      billDate: billDate ?? "",
      referenceNo,
      partyName: cellText(cellAt(row, "partyName")),
      // A blank Col D means the bill was opened at zero — not an unparsable cell.
      openingAmount: isBlank(openingRaw) ? 0 : parseAmount(openingRaw) ?? Number.NaN,
      pendingAmount: parseAmount(cellValue(cellAt(row, "pendingAmount"))) ?? Number.NaN,
      dueOn: dueOn ?? "",
      overdueDays: parseIntValue(cellValue(cellAt(row, "overdueDays"))) ?? 0,
      note: cellText(cellAt(row, "note")),
    };

    let error = validateBillInput(input);
    if (!error && billDateRaw && !isBlank(billDateRaw) && !billDate) {
      error = `Bill date is not a valid date (${cellText(cellAt(row, "billDate"))}).`;
    }
    if (!error && dueOnRaw && !isBlank(dueOnRaw) && !dueOn) {
      error = `Due on is not a valid date (${cellText(cellAt(row, "dueOn"))}).`;
    }

    if (error) {
      rows.push({ rowNumber: r, label, error, warnings: [] });
      continue;
    }

    const warnings = importWarnings(input);
    rows.push({ rowNumber: r, label, warnings, input });
  }

  return { rows, blankRows, mappingNote };
}

/** Advisory notes only — these never skip a row. */
function importWarnings(input: BillInput): string[] {
  return billWarnings({ referenceNo: input.referenceNo, billDate: input.billDate });
}

/** Group a result so the UI can say where rows actually landed. */
export function summariseRouting(
  inputs: readonly { referenceNo: string; departments: Role[] }[]
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { departments } of inputs) {
    const key = departments.length ? routeLabel(departments) : "Accounts only";
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}
