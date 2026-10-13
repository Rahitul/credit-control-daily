/**
 * Shared `.xlsx` download for every Pending Bills app. Each `route.ts` under
 * `app/*\/pending-bills/export` is a 4-line wrapper around this so accounts,
 * admin and the four department apps cannot drift apart.
 *
 * Uses `getSession` + `hasRole` rather than `requireRole`, because
 * `requireRole` *redirects* — wrong for a route handler, which should answer 403.
 * The session cookie is httpOnly and sent by the plain `<a href>` link, so there
 * is no token to thread through a client-side fetch.
 */

import type { NextRequest } from "next/server";
import { getSession, hasRole } from "@/lib/auth";
import { PENDING_BILL_ROLES } from "@/lib/nav";
import { selectPendingBills } from "@/lib/pendingBillsData";
import { buildWorkbook } from "@/lib/pendingBillsExcel";
import type { Role } from "@/lib/types";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * `department` is the app the download is for: a role key scopes the export to
 * that app's routed bills, `null` (accounts/admin) exports the whole register.
 *
 * `completed` exports the settled register instead of the outstanding one. The
 * workbook keeps the same A–H column layout on purpose — a completed file
 * should still be readable as a register, and it must not become a second
 * spreadsheet dialect that the import matcher does not understand. Col E reads
 * `0` on every row, which is the point: the bill is settled.
 */
export async function handlePendingBillExport(
  request: NextRequest,
  department: Role | null,
  completed = false
): Promise<Response> {
  const user = await getSession();
  if (!hasRole(user, ...PENDING_BILL_ROLES)) {
    return new Response("Forbidden", { status: 403 });
  }

  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const isTemplate = params.template === "1";

  // A template carries zero data rows — the example lives in the "How to fill"
  // sheet as text, so re-importing a template can never create a junk bill.
  //
  // The SESSION is passed through as the viewer, so a sales user's download runs
  // the same allocation-scoped query as their list. Omitting it here would leave
  // the one hole a sales user could still read the whole register through — an
  // export is the same list with the HTML stripped off.
  const rows = isTemplate
    ? []
    : (await selectPendingBills(params, department, completed, user)).rows;

  const workbook = buildWorkbook(rows, { template: isTemplate });
  const raw = await workbook.xlsx.writeBuffer();

  const stamp = new Date().toISOString().slice(0, 10);
  const scope = department ?? "all-departments";
  const kind = completed ? "completed-bills" : "pending-bills";
  const filename = isTemplate
    ? `${kind}-template.xlsx`
    : `${kind}-${scope}-${stamp}.xlsx`;

  return new Response(new Uint8Array(raw as ArrayBuffer), {
    headers: {
      "Content-Type": XLSX_MIME,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
