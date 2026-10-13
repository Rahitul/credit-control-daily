/**
 * Excel import reader for the Sales register — SERVER ONLY.
 *
 * Expected columns: Sale Date, Party's Name, Reference No., Sale Amount
 * The bill number and bill date are derived from the reference number.
 */

import ExcelJS from "exceljs";
import { IMPORT_MAX_ROWS } from "@/lib/pendingBills";

export const SALE_SHEET = "Sales";
export const HOW_TO_FILL_SHEET = "How to fill";

export type SaleInput = {
  saleDate: string;
  partyName: string;
  referenceId: string;
  amount: number;
};

export type ParsedSaleRow = {
  rowNumber: number;
  label: string;
  error?: string;
  warnings: string[];
  input?: SaleInput;
};

export type ParsedSaleImport = {
  rows: ParsedSaleRow[];
  blankRows: number;
  mappingNote: string;
};

const HEADER_ALIASES: Record<string, keyof SaleInput> = {
  "sale date": "saleDate",
  date: "saleDate",
  "party's name": "partyName",
  party: "partyName",
  customer: "partyName",
  "reference no": "referenceId",
  reference: "referenceId",
  ref: "referenceId",
  "reference no.": "referenceId",
  "sale amount": "amount",
  amount: "amount",
  total: "amount",
};

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

function parseDate(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }
  const s = String(v ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function parseAmount(v: unknown): number | null {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim().replace(/[৳,]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export async function readSaleWorkbook(buffer: ArrayBuffer): Promise<ParsedSaleImport> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new Error("That file could not be read as an .xlsx workbook.");
  }

  const ws =
    wb.getWorksheet(SALE_SHEET) ??
    wb.worksheets.find((s) => s.name !== HOW_TO_FILL_SHEET) ??
    wb.worksheets[0];
  if (!ws) throw new Error("That workbook has no sheet to read.");

  // Find header row
  let headerRow = 1;
  for (let r = 1; r <= Math.min(ws.rowCount, 10); r++) {
    const names = Array.from({ length: ws.columnCount }, (_, i) => {
      const cell = ws.getRow(r).getCell(i + 1);
      return (cell.text ?? "").trim().toLowerCase();
    });
    if (names.some((n) => n in HEADER_ALIASES)) {
      headerRow = r;
      break;
    }
  }

  const headerNames = Array.from({ length: ws.columnCount }, (_, i) => {
    const cell = ws.getRow(headerRow).getCell(i + 1);
    return (cell.text ?? "").trim().toLowerCase();
  });

  const colMap = new Map<keyof SaleInput, number>();
  headerNames.forEach((name, i) => {
    const key = HEADER_ALIASES[name];
    if (key && !colMap.has(key)) colMap.set(key, i + 1);
  });

  const REQUIRED: (keyof SaleInput)[] = ["saleDate", "partyName", "referenceId", "amount"];
  const missing = REQUIRED.filter((f) => !colMap.has(f));
  if (missing.length) {
    throw new Error(
      `The sheet is missing required column(s): ${missing.join(", ")}. Download the template and paste your data under its headers.`
    );
  }

  const cellAt = (row: ExcelJS.Row, field: keyof SaleInput): ExcelJS.Cell => {
    const col = colMap.get(field);
    return row.getCell(col ?? 1);
  };

  const rows: ParsedSaleRow[] = [];
  let blankRows = 0;

  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (REQUIRED.every((f) => isBlank(cellValue(cellAt(row, f))))) {
      blankRows++;
      continue;
    }
    if (rows.length >= IMPORT_MAX_ROWS) {
      throw new Error(
        `That sheet has more than ${IMPORT_MAX_ROWS} data rows. Split it into smaller files.`
      );
    }

    const referenceId = cellText(cellAt(row, "referenceId"));
    const label = referenceId || `row ${r}`;
    const saleDateRaw = cellValue(cellAt(row, "saleDate"));
    const saleDate = parseDate(saleDateRaw);
    const partyName = cellText(cellAt(row, "partyName"));
    const amount = parseAmount(cellValue(cellAt(row, "amount")));

    let error: string | undefined;
    if (!saleDate) error = `Sale date is not a valid date (${cellText(cellAt(row, "saleDate"))}).`;
    else if (!partyName) error = "Party's Name is required.";
    else if (!referenceId) error = "Reference No. is required.";
    else if (amount === null) error = "Sale Amount is required (cell is blank).";
    else if (amount <= 0) error = `Sale Amount must be a positive number (got ${amount}).`;

    if (error) {
      rows.push({ rowNumber: r, label, error, warnings: [] });
      continue;
    }

    rows.push({
      rowNumber: r,
      label,
      warnings: [],
      input: { saleDate: saleDate!, partyName, referenceId, amount: amount! },
    });
  }

  return { rows, blankRows, mappingNote: "Columns matched by header name." };
}
