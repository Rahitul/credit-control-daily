/**
 * Shared `.xlsx` download for every Customers app. Each `route.ts` under
 * `app/*\/customers/export` is a 4-line wrapper around this so accounts, admin
 * and the department apps cannot drift apart.
 *
 * Uses `getSession` + `hasRole` rather than `requireRole`, because
 * `requireRole` *redirects* — wrong for a route handler, which should answer 403.
 */

import type { NextRequest } from "next/server";
import { getSession, hasRole } from "@/lib/auth";
import { buildCustomerWorkbook } from "@/lib/customersExcel";
import { listCustomers } from "@/lib/customersList";
import { ENTRY_ROLES } from "@/lib/nav";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function handleCustomerExport(request: NextRequest): Promise<Response> {
  const user = await getSession();
  if (!user || !hasRole(user, ...ENTRY_ROLES, "admin")) {
    return new Response("Forbidden", { status: 403 });
  }

  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const isTemplate = params.template === "1";

  // A template carries zero data rows — the example lives in the "How to fill"
  // sheet as text, so re-importing a template can never create a junk customer.
  //
  // The SESSION is passed through as the viewer and the query params are the
  // same ones the list reads, so a filtered download is that filtered list with
  // the HTML stripped off — including the "only my entries" rule for
  // non-admin/accounts departments.
  const rows = isTemplate ? [] : (await listCustomers(params, user)).rows;

  const workbook = buildCustomerWorkbook(rows, { template: isTemplate });
  const raw = await workbook.xlsx.writeBuffer();

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = isTemplate ? "customers-template.xlsx" : `customers-${stamp}.xlsx`;

  return new Response(new Uint8Array(raw as ArrayBuffer), {
    headers: {
      "Content-Type": XLSX_MIME,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
