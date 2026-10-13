/**
 * SERVER-ONLY: the Customers list pipeline, shared by `CustomersView` and the
 * `.xlsx` export handler so a download can never disagree with the screen.
 *
 * Only `q` reaches Mongo (inside `getCustomerCredits`); everything else is a
 * JS-side filter applied here, in the order the list has always used. The
 * export therefore carries the same rows, in the same order, as the table —
 * and it honours the same visibility rule (admin/accounts see everyone, other
 * departments only the customers they entered).
 */

import { hasRole } from "@/lib/auth";
import { getCustomerCredits, type CustomerCreditRow } from "@/lib/credit";
import { ENTRY_ROLES, seesAllEntries } from "@/lib/nav";
import type { SessionUser } from "@/lib/types";

export type CustomerListParams = Record<string, string | string[] | undefined>;

export const CUSTOMER_SORTS = [
  { value: "name", label: "Name A–Z" },
  { value: "outstanding", label: "Outstanding high" },
  { value: "totalSales", label: "Total sales high" },
  { value: "overdue", label: "Most overdue" },
  { value: "collected", label: "Collected high" },
] as const;

export type CustomerListResult = {
  /** Full filtered + sorted set — the count line and the Excel export read this. */
  rows: CustomerCreditRow[];
  seesAll: boolean;
  showFinancials: boolean;
  isAdmin: boolean;
  pendingCount: number;
  deptOptions: string[];
  branches: string[];
  groups: string[];
  sort: string;
};

function param(params: CustomerListParams, key: string): string {
  const v = params[key];
  return typeof v === "string" ? v : "";
}

export async function listCustomers(
  params: CustomerListParams,
  user: SessionUser
): Promise<CustomerListResult> {
  const q = param(params, "q");
  const category = param(params, "category");
  const group = param(params, "group");
  const status = param(params, "status");
  const branch = param(params, "branch");
  const approval = param(params, "approval");
  const dept = param(params, "dept");
  const sort = param(params, "sort") || "name";

  const seesAll = seesAllEntries(user.roles);

  let rows = await getCustomerCredits({ q, viewer: user, approval: "all" });
  if (!seesAll) {
    rows = rows.filter((r) => r.createdBy === user.id);
  }
  // Department options are derived from the visibility-scoped set only, so a
  // category filter cannot empty the dropdown that produced it.
  const deptOptions = [...new Set(rows.map((r) => r.createdByRole ?? ""))].sort();

  if (category) {
    rows = rows.filter((r) => (r.category ?? "") === category);
  }
  if (group) {
    rows = rows.filter((r) => r.group === group);
  }
  if (status === "overdue" || status === "within") {
    rows = rows.filter((r) => r.status === status);
  }
  if (branch) {
    rows = rows.filter((r) => (r.branch ?? "") === branch);
  }
  if (approval === "pending" || approval === "approved") {
    rows = rows.filter((r) => r.approvalStatus === approval);
  }
  if (dept === "unknown") {
    rows = rows.filter((r) => !r.createdByRole);
  } else if (dept) {
    rows = rows.filter((r) => (r.createdByRole ?? "") === dept);
  }

  rows = [...rows].sort((a, b) => {
    switch (sort) {
      case "outstanding":
        return b.outstanding - a.outstanding;
      case "totalSales":
        return b.totalSales - a.totalSales;
      case "overdue":
        return b.overdueAmount - a.overdueAmount || b.daysOverdue - a.daysOverdue;
      case "collected":
        return b.totalCollected - a.totalCollected;
      default:
        return a.name.localeCompare(b.name);
    }
  });

  return {
    rows,
    seesAll,
    showFinancials: hasRole(user, ...ENTRY_ROLES, "admin"),
    isAdmin: hasRole(user, "admin"),
    pendingCount: rows.filter((r) => r.approvalStatus === "pending").length,
    deptOptions,
    branches: [...new Set(rows.map((r) => r.branch).filter((b): b is string => !!b))].sort(),
    groups: [...new Set(rows.map((r) => r.group))].sort(),
    sort,
  };
}
