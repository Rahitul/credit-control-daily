import type { Role } from "@/lib/types";
import {
  AlertTriangle,
  BarChart3,
  CircleCheckBig,
  FileClock,
  FilePlus,
  FileText,
  GitFork,
  History,
  LayoutDashboard,
  ListChecks,
  PlusCircle,
  Receipt,
  ShoppingCart,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  roles: Role[] | "all";
};

type RelNavItem = Omit<NavItem, "href"> & { path: string };

export const ADMIN_ROLES: Role[] = ["admin"];
export const ACCOUNTS_ROLES: Role[] = ["accounts", "creditcontrol", "admin"];
export const ENTRY_ROLES: Role[] = [
  "accounts",
  "creditcontrol",
  "sales",
  "eid",
  "esbd",
  "consumable",
  "branches",
];

/**
 * The department apps a Pending Bill or Sale can be ROUTED to (see `BILL_ROUTES`
 * in `lib/pendingBills.ts`, plus branch-prefix routing in `lib/branches.ts`).
 * Accounts/Admin are deliberately absent: they are not department apps, they are
 * the unscoped consolidated view. Used to decide whether a user may edit/delete a
 * row that is not in their own list.
 */
export const DEPARTMENT_ROLES: Role[] = [
  "sales",
  "eid",
  "esbd",
  "consumable",
  "branches",
];

/**
 * Who can reach Pending Bills at all. The register is now spread across every
 * department app, because a bill is routed by its bill-number prefix (see
 * `BILL_ROUTES` in `lib/pendingBills.ts`): a `TS-…` bill lives in Consumable, a
 * `WO-…` bill in EID, a `CW-…` bill in ESBD, an `S-…` bill in Sales, and
 * anything that matches no prefix stays visible to Accounts only.
 *
 * Single source of truth shared by the nav items and every role re-check in
 * `app/actions/pendingBills.ts` + the export route handlers. Accounts/Admin are
 * NOT scoped by department — they see every bill, routed or not.
 */
export const PENDING_BILL_ROLES: Role[] = [...ENTRY_ROLES, "admin"];

/**
 * Who may APPROVE a payment.
 *
 * Any entry role can submit a payment, but only Accounts/Admin release the money
 * against a bill — approving is the only thing that reduces a `PendingBill`'s
 * `pendingAmount` (see `lib/paymentAllocation.ts`). Self-approval is blocked
 * separately, in the action, by comparing `Payment.createdBy` with the session id.
 */
export const PAYMENT_APPROVER_ROLES: Role[] = ["accounts", "creditcontrol", "admin"];

const REL_NAV: RelNavItem[] = [
  {
    path: "",
    label: "Dashboard",
    icon: LayoutDashboard,
    roles: "all",
  },
  {
    path: "/customers",
    label: "Customers",
    icon: Users,
    roles: "all",
  },
  {
    path: "/customers/new",
    label: "Add Customer",
    icon: UserPlus,
    roles: ENTRY_ROLES,
  },
  {
    path: "/sales",
    label: "Sales",
    icon: ShoppingCart,
    roles: "all",
  },
  {
    path: "/sales/new",
    label: "New Sale",
    icon: PlusCircle,
    roles: ENTRY_ROLES,
  },
  {
    path: "/payments",
    label: "Payments",
    icon: Receipt,
    roles: "all",
  },
  {
    path: "/payments/new",
    label: "New Payment",
    icon: Wallet,
    roles: ENTRY_ROLES,
  },
  {
    path: "/pending-bills",
    label: "Pending Bills",
    icon: FileClock,
    roles: PENDING_BILL_ROLES,
  },
  {
    path: "/pending-bills/new",
    label: "New Pending Bill",
    icon: FilePlus,
    roles: PENDING_BILL_ROLES,
  },
  {
    path: "/completed-bills",
    label: "Completed Bills",
    icon: CircleCheckBig,
    roles: PENDING_BILL_ROLES,
  },
  {
    // Accounts/Admin hand the sales register out row by row, so this control is
    // deliberately NOT in a department sidebar — a sales user has nothing to
    // distribute and must not be able to reach the page at all.
    path: "/distribute",
    label: "Distribute Work",
    icon: UserCheck,
    roles: ACCOUNTS_ROLES,
  },
  {
    path: "/branches",
    label: "Branches",
    icon: GitFork,
    roles: ["admin"],
  },
  {
    path: "/users",
    label: "Users & Roles",
    icon: Users,
    roles: ["admin"],
  },
  {
    path: "/alerts",
    label: "Overdue Alerts",
    icon: AlertTriangle,
    roles: ["admin"],
  },
  {
    path: "/reports",
    label: "Reports & Export",
    icon: FileText,
    roles: ["admin"],
  },
  {
    path: "/activity",
    label: "Activity Log",
    icon: History,
    roles: ["admin"],
  },
  {
    path: "/breakdown",
    label: "Bank & Type Breakdown",
    icon: BarChart3,
    roles: ["admin"],
  },
  {
    path: "/dropdowns",
    label: "Manage Dropdowns",
    icon: ListChecks,
    roles: "all",
  },
];

export const ROLE_HOMES: Record<Role, string> = {
  admin: "/admin",
  accounts: "/accounts",
  sales: "/sales",
  eid: "/eid",
  eid_juniors: "/eid_juniors",
  esbd: "/esbd",
  consumable: "/consumable",
  branches: "/branches",
  creditcontrol: "/creditcontrol",
};

/**
 * Who sees the full list vs only their own rows:
 * - admin + accounts apps → every record
 * - all other roles (sales/eid/esbd/consumable) → only entries they created
 *   (`Sale.entryBy` / `Payment.entryBy` = their name, `Customer.createdBy` = their id)
 */
export function seesAllEntries(roles: Role[]): boolean {
  return roles.some((r) => ACCOUNTS_ROLES.includes(r));
}

/**
 * Is this user's view of a list work-allocated rather than open?
 *
 * True for a user who holds `sales` but NOT accounts/admin: the sales app is
 * handed to them row by row by Accounts/Admin (`assignedTo`), so an unassigned
 * row is invisible to them. False for everyone else, which keeps the eid /
 * esbd / consumable lists and the accounts consolidated view exactly as they were.
 */
export function isSalesAllocated(roles: Role[]): boolean {
  return !seesAllEntries(roles) && roles.includes("sales");
}

/**
 * The Mongo clause that restricts a sales-app list to the viewer's own rows.
 *
 * Returns `null` for every unrestricted reader, so callers can spread it into a
 * query unconditionally. This is the ONLY place that decision is written — the
 * list, the Excel exports and the write guards all call it, which is what stops
 * them from disagreeing about who can see a row.
 *
 * `department` is the app the list is scoped to. A `sales`+`eid` user asking for
 * their EID list must still get the whole EID register, so the clause is skipped
 * for any department other than sales; a `null` department (Accounts/Admin, which
 * never reaches here because `seesAllEntries` short-circuits) is treated as
 * sales, i.e. still scoped. Fail closed is the point: a sales user must never be
 * able to widen their own list by guessing a query parameter.
 */
export function salesAssigneeClause(
  roles: Role[],
  userId: string,
  department: Role | null
): { assignedTo: string } | null {
  if (!isSalesAllocated(roles)) return null;
  if (department && department !== "sales") return null;
  return { assignedTo: userId };
}

/**
 * The `assignedTo` value a NEW row should get, or `undefined` for none.
 *
 * The fail-safe this whole feature rests on: a sales user who creates a bill or a
 * sale must be able to see it afterwards. So when the actor is sales-allocated
 * AND the row routes to sales, the row lands on their own desk automatically.
 * An Accounts/Admin user gets `undefined` — their rows sit unassigned and
 * invisible to the sales app until somebody deliberately distributes them, which
 * is the entire point of the workflow.
 *
 * Only call this on INSERT. Re-running it on an update would silently move an
 * already-distributed row back to the editor.
 */
export function assigneeForNewRow(
  roles: Role[],
  userId: string,
  departments: readonly Role[]
): { assignedTo: string } | undefined {
  if (!isSalesAllocated(roles)) return undefined;
  if (!departments.includes("sales")) return undefined;
  return { assignedTo: userId };
}

export function primaryRole(roles: Role[]): Role {
  if (roles.includes("admin")) return "admin";
  if (roles.includes("accounts")) return "accounts";
  if (roles.includes("creditcontrol")) return "creditcontrol";
  return roles[0] ?? "sales";
}

export function homeForRoles(roles: Role[]): string {
  return ROLE_HOMES[primaryRole(roles)];
}

/**
 * Where a just-saved pending bill actually lives. A Consumable user who types
 * `S-99` creates a Sales bill, so the post-save redirect must follow the routing
 * rather than the app they happened to submit from — otherwise they'd be dumped
 * on a list that no longer contains their row.
 */
export function pendingBillHome(departments: readonly Role[]): string {
  return departments[0] ? ROLE_HOMES[departments[0]] : ROLE_HOMES.accounts;
}

/**
 * Full sidebar replacements for roles whose app is deliberately narrower than
 * the shared `REL_NAV` grid. Keyed on the viewer's `primaryRole`; the first
 * entry must be the item that lands on a real page under the role home, because
 * `AppShell` treats `items[0].href` as the active-state home link.
 *
 * `eid_juniors` is a read-only sidecar on the EID register: Pending Bills
 * (follow-ups only — no new/edit routes exist under `/eid_juniors`) and Payments.
 */
const NAV_OVERRIDES: Partial<Record<Role, RelNavItem[]>> = {
  eid_juniors: [
    { path: "/pending-bills", label: "Pending Bills", icon: FileClock, roles: ["eid_juniors"] },
    { path: "/payments", label: "Payments", icon: Receipt, roles: ["eid_juniors"] },
  ],
  creditcontrol: REL_NAV.filter((item) => item.path !== "/distribute"),
};

export function navForRoles(roles: Role[]): NavItem[] {
  const home = homeForRoles(roles);
  const source = NAV_OVERRIDES[primaryRole(roles)] ?? REL_NAV;
  return source
    .filter(
      (item) => item.roles === "all" || item.roles.some((r) => roles.includes(r))
    )
    .map(({ path, ...item }) => ({
      ...item,
      href: path ? `${home}${path}` : home,
    }));
}
