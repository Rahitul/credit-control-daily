export const ROLES = [
  "esbd",
  "consumable",
  "sales",
  "eid",
  "eid_juniors",
  "branches",
  "accounts",
  "creditcontrol",
  "admin",
] as const;

export type Role = (typeof ROLES)[number];

export const DEPARTMENTS = [
  "Accounts",
  "Sales",
  "EID",
  "ESBD",
  "Consumable",
  "Branches",
] as const;

export type Department = (typeof DEPARTMENTS)[number];

export const CUSTOMER_CATEGORIES = [
  "Retail",
  "Wholesale",
  "Corporate",
  "Government",
  "Distributor",
  "Other",
] as const;

export const DEFAULT_CUSTOMER_GROUP = "Not a Group of Company";

export const ROLE_LABELS: Record<Role, string> = {
  esbd: "ESBD",
  consumable: "Consumable",
  sales: "Sales",
  eid: "EID",
  eid_juniors: "EID Juniors",
  branches: "Branches",
  accounts: "Accounts",
  creditcontrol: "Credit Control",
  admin: "Admin",
};

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  roles: Role[];
  department?: string;
  /**
   * The `Branch` this user is assigned to, set by Admin on the Users & Roles
   * page. It is part of the signed session payload, so a branch change reaches
   * the user on their next sign-in rather than instantly.
   */
  branchId?: string;
};

export type ActionResult = {
  ok: boolean;
  error?: string;
  id?: string;
  home?: string;
};

export const PAYMENT_TYPES = [
  "Cash",
  "Cheque",
  "bKash",
  "Nagad",
  "Bank Transfer",
  "Card",
] as const;

export const BANK_TYPES = ["City Bank", "BRAC Bank", "EBL", "DBBL", "IBBL", "Other"] as const;

export const DROPDOWN_TYPES = [
  "category",
  "branch",
  "billCategory",
  "paymentType",
  "bankType",
  "bankName",
] as const;

export type DropdownType = (typeof DROPDOWN_TYPES)[number];
