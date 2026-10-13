/**
 * Excel export for the Sales register — SERVER ONLY.
 *
 * Columns: Sale Date, Party's Name, Reference No., Sale Amount
 */

import ExcelJS from "exceljs";
import type { ISale } from "@/lib/models/Sale";

export const SALE_SHEET = "Sales";
export const HOW_TO_FILL_SHEET = "How to fill";

const COLUMNS = [
  { header: "Sale Date", width: 14, format: "date" },
  { header: "Party's Name", width: 30, format: "text" },
  { header: "Reference No.", width: 22, format: "text" },
  { header: "Sale Amount", width: 16, format: "amount" },
] as const;

export function buildSaleWorkbook(
  rows: readonly ISale[],
  opts: { template?: boolean } = {}
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Credit Control Daily";
  wb.created = new Date();

  const ws = wb.addWorksheet(SALE_SHEET, {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  const headers = COLUMNS.map((c) => c.header);
  ws.addRow(headers);
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4338CA" } };
  head.alignment = { vertical: "middle" };
  head.height = 22;
  COLUMNS.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width;
  });

  if (!opts.template) {
    for (const r of rows) {
      const row = ws.addRow([
        r.saleDate,
        "",
        r.referenceId,
        r.amount,
      ]);
      row.getCell(1).numFmt = "dd-mmm-yyyy";
      row.getCell(4).numFmt = "#,##0.00";
    }
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: COLUMNS.length },
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
  ws.addRow([
    "Party's Name",
    "The customer or company name for this sale.",
  ]);
  ws.addRow([
    "Reference No.",
    "The unique sale reference, e.g. SALE-2026-0001.",
  ]);
  ws.addRow([
    "Sale Amount",
    "The total sale amount in BDT.",
  ]);
  ws.addRow([
    "Sale Date",
    "The date of the sale (dd-mmm-yyyy).",
  ]);

  ws.addRow([]);
  ws.addRow([
    "Import rules",
    "• A row is matched to an existing sale by Reference No., so re-importing updates instead of duplicating.",
    "",
  ]);
  ws.addRow(["", "• Bad rows are skipped and reported; the good rows are still imported."]);
  ws.addRow(["", "• The bill number and bill date are derived from the reference number on import."]);

  ws.addRow([]);
  const head = ws.addRow(["Column", "What goes in it"]);
  head.font = { bold: true };

  for (const col of COLUMNS) {
    ws.addRow([col.header, `See above`]);
  }

  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    row.getCell(1).font = row.getCell(1).font?.bold ? row.getCell(1).font : { bold: true };
    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
  }
}
