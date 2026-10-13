/**
 * Shared .xlsx download for the Sales register. Each route.ts under
 * app/&lt;role&gt;/sales/export is a thin wrapper around this.
 *
 * Uses getSession + hasRole rather than requireRole, because
 * requireRole *redirects* — wrong for a route handler, which should answer 403.
 */

import type { NextRequest } from "next/server";
import { getSession, hasRole } from "@/lib/auth";
import { ENTRY_ROLES, salesAssigneeClause } from "@/lib/nav";
import { Sale } from "@/lib/models/Sale";
import { buildSaleWorkbook } from "@/lib/saleExcel";
import type { Role } from "@/lib/types";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function handleSaleExport(
  request: NextRequest,
  department: Role | null
): Promise<Response> {
  const user = await getSession();
  if (!hasRole(user, ...ENTRY_ROLES, "admin")) {
    return new Response("Forbidden", { status: 403 });
  }

  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const isTemplate = params.template === "1";

  const query: Record<string, unknown> = {};
  if (department) {
    query.departments = department;
  }
  // Same allocation clause the Sales list applies, so a sales user's download is
  // their screen and not the whole department's book. `getSession` already
  // returned the user (and answered 403 without it), so this cannot widen.
  if (user) {
    const clause = salesAssigneeClause(user.roles, user.id, department);
    if (clause) Object.assign(query, clause);
  }

  const rows = isTemplate
    ? []
    : await Sale.find(query).limit(500).lean().exec();

  const workbook = buildSaleWorkbook(rows, { template: isTemplate });
  const raw = await workbook.xlsx.writeBuffer();

  const stamp = new Date().toISOString().slice(0, 10);
  const scope = department ?? "all-departments";
  const filename = isTemplate
    ? "sales-template.xlsx"
    : `sales-${scope}-${stamp}.xlsx`;

  return new Response(new Uint8Array(raw as ArrayBuffer), {
    headers: {
      "Content-Type": XLSX_MIME,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
