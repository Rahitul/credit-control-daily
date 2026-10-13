import { formatBDT, formatDate } from "@/lib/format";
import { getCustomerCredits, allocatePayments, nextSaleReferenceId, type CustomerCreditRow } from "@/lib/credit";
import { db } from "@/lib/db";
import { Sale } from "@/lib/models/Sale";
import { Payment } from "@/lib/models/Payment";
import { Customer } from "@/lib/models/Customer";
import { BANK_TYPES, CUSTOMER_CATEGORIES, PAYMENT_TYPES, type SessionUser } from "@/lib/types";
import { INTENTS, type IntentId, WELCOME_EXAMPLES } from "@/lib/chat/intents";
import type { ParsedQuery } from "@/lib/chat/parse";
import type { DateRange } from "@/lib/chat/dates";

const LIST_CAP = 12;

type RangeFilters = {
  customerId?: string;
  customerIds?: string[];
  paymentType?: string | null;
  bankType?: string | null;
  entryBy?: string | null;
  assignedPerson?: string | null;
  branch?: string | null;
  minAmount?: number | null;
  maxAmount?: number | null;
};

function money(n: number): string {
  return formatBDT(n);
}

function rangeLabel(r: DateRange | null): string {
  return r ? r.label : "all time";
}

function filterBits(q: ParsedQuery, kind: "sales" | "payments"): string[] {
  const bits: string[] = [];
  if (q.dateRange) bits.push(q.dateRange.label);
  if (q.category) bits.push(q.category);
  if (q.branch) bits.push(q.branch);
  if (q.group) bits.push(`group ${q.group}`);
  if (kind === "payments") {
    if (q.paymentType) bits.push(q.paymentType);
    if (q.bankType) bits.push(q.bankType);
    if (q.assignedPerson) bits.push(`assigned ${q.assignedPerson}`);
  }
  if (q.entryBy) bits.push(`by ${q.entryBy}`);
  if (q.minAmount !== null) bits.push(`≥ ${money(q.minAmount)}`);
  if (q.maxAmount !== null) bits.push(`≤ ${money(q.maxAmount)}`);
  if (q.minDays !== null) bits.push(`≥ ${q.minDays}d overdue`);
  if (q.approval) bits.push(q.approval);
  if (q.customerHint && !q.dateRange) bits.push(q.customerHint);
  return bits;
}

function filtersLine(q: ParsedQuery, kind: "sales" | "payments"): string {
  const bits = filterBits(q, kind).filter((b) => b !== q.dateRange?.label);
  return bits.length ? `Filters: ${bits.join(" · ")}` : "";
}

function filterCreditRows(rows: CustomerCreditRow[], q: ParsedQuery, status?: "overdue" | "within"): CustomerCreditRow[] {
  let list = [...rows];
  const st = status ?? q.status;
  if (st) list = list.filter((r) => r.status === st);
  if (q.category) list = list.filter((r) => (r.category ?? "") === q.category);
  if (q.branch) list = list.filter((r) => r.branch === q.branch);
  if (q.group) list = list.filter((r) => r.group === q.group);
  if (q.approval) list = list.filter((r) => r.approvalStatus === q.approval);
  if (q.minDays !== null) {
    const min = q.minDays;
    list = list.filter((r) => r.status === "overdue" && r.daysOverdue >= min);
  }
  if (q.minAmount !== null) list = list.filter((r) => r.outstanding >= (q.minAmount ?? 0));
  if (q.maxAmount !== null) list = list.filter((r) => r.outstanding <= (q.maxAmount ?? 0));
  return list;
}

export function matchIntent(q: ParsedQuery): IntentId {
  const scores = new Map<IntentId, number>();

  const add = (id: IntentId, n: number) => {
    scores.set(id, (scores.get(id) ?? 0) + n);
  };

  for (const intent of INTENTS) {
    for (const kw of intent.keywords) {
      if (q.lower.includes(kw)) {
        add(intent.id, kw.length + intent.priority);
      }
    }
  }

  if (q.saleRef) {
    if (/\bpaid\b|\bunpaid\b|\bfully\b|\bremaining\b/.test(q.lower)) add("sale_paid_status", 300);
    else if (/\bpayment/.test(q.lower)) add("payments_for_sale", 280);
    else add("sale_lookup", 260);
  }
  if (q.billNo) add("payment_lookup", 280);

  // Company-level date questions (no real customer in the phrase)
  const hasCompanyPronoun =
    /\b(we|our|us|company|business|give me|show me|how much have we|how much did we|total company)\b/.test(
      q.lower
    );
  const companyLevel =
    hasCompanyPronoun ||
    /\b(how much|give me|show)\b/.test(q.lower) ||
    (!!q.customerHint === false && /\b(total|all|every)\b/.test(q.lower));

  const looksCompanyCollection =
    /\b(collections?|collected|collection)\b/.test(q.lower) &&
    (companyLevel || /\b(all|give me|show|total)\b/.test(q.lower));
  const looksCompanySales =
    /\bsales?\b/.test(q.lower) &&
    (companyLevel || /\b(all|give me|show|total)\b/.test(q.lower));

  if (q.dateRange && q.customerHint && !companyLevel && /\bsale|bought|sold|purchase|what was the sale|what did/.test(q.lower) && !looksCompanySales) {
    add("customer_sales_range", 300);
  }
  if (q.dateRange && q.customerHint && !companyLevel && /\bpayment|paid|collected|received|collection/.test(q.lower)) {
    const filterPerson = !!(q.paymentType || q.bankType || q.assignedPerson || q.entryBy);
    if (
      !filterPerson &&
      !/\bhow much have we collected\b|\bwe collected\b|\btotal collected\b|\bcollected in\b|\bcollected last\b|\bcollected this\b|\bcollected previous\b/.test(q.lower) &&
      !looksCompanyCollection
    ) {
      add("customer_payments_range", 300);
      // Profile + period collection: "tell me about X from 1 sep to 30 sep about the collection"
      if (/\btell me about\b|\babout the collection\b|\babout collection\b|\babout the payment/.test(q.lower)) {
        add("customer_profile", 360);
      }
    } else if (filterPerson) {
      add("list_payments_filtered", 280);
      add("company_payments_range", 140);
    }
  }
  if (q.dateRange && /\bhow many sales\b/.test(q.lower)) add("count_sales_range", 250);
  if (q.dateRange && /\bhow many\b.*\bpayments?\b/.test(q.lower)) add("count_payments_range", 300);
  if (q.dateRange && looksCompanySales && (!q.customerHint || companyLevel)) add("company_sales_range", 200);
  if (q.dateRange && /\bsales?\b/.test(q.lower) && !q.customerHint) add("company_sales_range", 140);
  const preferPaymentList =
    (q.paymentType || q.bankType || q.assignedPerson) && !q.customerHint && /\blist\b|\bshow\b|\ball\b|\bhow many\b/.test(q.lower);
  if (
    q.dateRange &&
    !preferPaymentList &&
    /\bpayment|collected|received|collections?\b/.test(q.lower) &&
    (!q.customerHint || companyLevel || looksCompanyCollection || /\bcollected\b/.test(q.lower))
  ) {
    add("company_payments_range", looksCompanyCollection ? 220 : 180);
  }
  // Explicit multi-day range phrasing ("1 sep to 30 sep") → prefer company range intents
  if (q.dateRange && isMultiDayRange(q.dateRange) && !preferPaymentList) {
    if (/\bsales?\b/.test(q.lower) && !/\bcollections?\b|\bcollected\b|\bpayments?\b/.test(q.lower)) {
      add("company_sales_range", 80);
    }
    if (/\bcollections?\b|\bcollected\b|\bpayments?\b|\bcollection\b/.test(q.lower)) {
      add("company_payments_range", 80);
    }
  }
  // Strong preference for all-time collected total when no date
  if (!q.dateRange && /\bhow much have we collected\b|\btotal collected\b|\bcollected total\b/.test(q.lower)) {
    add("collected_total", 200);
  }
  if (q.minDays !== null) add("list_overdue_min_days", 200);
  if (q.customerHint && /\bcontact|phone|address\b/.test(q.lower)) add("customer_contact", 100);
  if (q.customerHint && /\bpayment term|credit limit|day term\b/.test(q.lower)) add("customer_terms", 100);
  if (q.customerHint && /\btotal sale|sales of|sale of|how much sale\b/.test(q.lower)) {
    add("customer_sales_total", 110);
  }
  if (q.customerHint && /\boutstanding\b|\bbalance\b|\bdues\b|\bowed\b/.test(q.lower)) {
    add("customer_outstanding", 90);
  }
  if (
    q.customerHint &&
    /\btell me about\b|\bab(?:out)?\s+company\b|\bcompany (?:profile|overview|summary)\b|\bsummary of\b|\boverview of\b/.test(q.lower)
  ) {
    add("customer_profile", 320);
  }
  // Customer payment habits / banks
  if (q.customerHint && /\bwhich payment type|payment types?\b|\bhow does\b.*\bpay|\bpayment method\b|\bpays?\b|\bpay by\b|\busually pay\b/.test(q.lower)) {
    add("customer_payment_types", 340);
  }
  if (q.customerHint && /\bwhich bank\b|\bwhat bank\b|\bbank does\b|\bbank type\b|\bwhich bank type\b/.test(q.lower)) {
    add("customer_banks", 350);
  }
  // Short customer phrasing: "Global Tech Ltd collection" / "… collected" / "… payment"
  if (
    q.customerHint &&
    !hasCompanyPronoun &&
    !q.saleRef &&
    !q.billNo &&
    /\bcollections?\b|\bcollected\b|\bpaid\b|\bbalance\b|\bpaid so far\b|\btotal collection\b/.test(q.lower) &&
    !/\bwe\b|\bour\b|\bcompany\b/.test(q.lower)
  ) {
    if (/\btell me about\b/.test(q.lower)) add("customer_profile", 340);
    else add("customer_collected", 380);
    add("collected_total", -300);
    add("outstanding_total", -80);
  }
  // Bare "X payment(s)" without company markers → customer collection/status, not help
  if (q.customerHint && !hasCompanyPronoun && !q.dateRange && /\bpayments?\b|\bcollection\b/.test(q.lower)) {
    add("customer_collected", 200);
    add("customer_status", 40);
  }
  if (
    q.customerHint &&
    !hasCompanyPronoun &&
    /\boutstanding\b|\bbalance\b|\bdues\b|\bowed\b/.test(q.lower)
  ) {
    add("customer_outstanding", 280);
    add("outstanding_total", -240);
  }
  if (q.customerHint && !hasCompanyPronoun && /\bsales?\b/.test(q.lower) && !/\bcollection|collected|payments?|paid\b/.test(q.lower)) {
    if (/\btotal|lifetime|how much sale/.test(q.lower)) add("customer_sales_total", 260);
    else add("customer_profile", 120);
    add("sales_total", -120);
  }
  // Pending / filtered lists
  if (q.approval === "pending" && /\blist|show|who|pending\b/.test(q.lower)) add("list_pending_customers", 280);
  if (/\blist|show|all\b/.test(q.lower) && (q.category || q.branch || q.group) && !/\boverdue\b|\bwithin\b/.test(q.lower)) {
    add("list_customers_filtered", 260);
  }
  if ((q.paymentType || q.bankType || q.assignedPerson) && !q.customerHint) {
    if (/\blist\b|\bshow\b|\ball\b/.test(q.lower)) {
      add("list_payments_filtered", 300);
    } else if (/\bhow many\b/.test(q.lower)) {
      add("count_payments_range", 350);
    } else if (/\bhow much\b|\btotal\b/.test(q.lower)) {
      add("company_payments_range", 220);
    } else {
      add("list_payments_filtered", 240);
      add("company_payments_range", 120);
    }
  }
  if (q.entryBy && /\bsales?\b/.test(q.lower) && !/\bbreakdown\b|\bsales by entry\b|\bentryby\b|\bby entry\b|\bwho entered\b/.test(q.lower)) {
    add("list_sales_filtered", 200);
    add("company_sales_range", 160);
  }
  // Filtered counts
  if (q.dateRange === null && (q.category || q.branch) && /\bhow many overdue\b|\bcount overdue\b/.test(q.lower)) {
    add("count_overdue", 80);
  }

  let bestId: IntentId = "help";
  let bestScore = 0;
  for (const [id, score] of scores) {
    if (score > bestScore) {
      bestScore = score;
      bestId = id;
    }
  }
  return bestScore > 0 ? bestId : "help";
}

function findCustomers(hint: string, rows: CustomerCreditRow[]): {
  exact: CustomerCreditRow | null;
  candidates: CustomerCreditRow[];
} {
  const h = hint.toLowerCase().replace(/\s+/g, " ").trim();
  if (!h) return { exact: null, candidates: [] };

  const scored = rows
    .map((r) => {
      const name = r.name.toLowerCase();
      let score = 0;
      if (name === h) score = 100;
      else if (name.includes(h)) score = 80;
      else if (h.includes(name)) score = 70;
      else {
        const parts = h.split(/\s+/).filter(Boolean);
        const hits = parts.filter((p) => p.length >= 3 && name.includes(p)).length;
        if (hits > 0) score = 40 + hits * 10;
      }
      return { row: r, score };
    })
    .filter((x) => x.score >= 40)
    .sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name));

  return {
    exact: scored[0]?.row ?? null,
    candidates: scored.slice(0, 5).map((x) => x.row),
  };
}

function customerHeader(r: CustomerCreditRow): string {
  return r.name;
}

function applyRangeFilters(query: Record<string, unknown>, f: RangeFilters) {
  if (f.customerId) query.customerId = f.customerId;
  if (f.customerIds) query.customerId = { $in: f.customerIds };
  if (f.paymentType) query.paymentType = f.paymentType;
  if (f.bankType) query.$or = [{ bankType: f.bankType }, { bankName: f.bankType }];
  if (f.entryBy) query.entryBy = f.entryBy;
  if (f.assignedPerson) query.assignedPerson = f.assignedPerson;
  if (f.branch) query.branch = f.branch;
}

function applyAmountBounds(query: Record<string, unknown>, field: "amount" | "rcvAmount", f: RangeFilters) {
  if (f.minAmount !== null && f.minAmount !== undefined) {
    query[field] = { ...((query[field] as object) ?? {}), $gte: f.minAmount };
  }
  if (f.maxAmount !== null && f.maxAmount !== undefined) {
    query[field] = { ...((query[field] as object) ?? {}), $lte: f.maxAmount };
  }
}

function salesMatch(f: RangeFilters, range?: DateRange | null): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  if (range) query.saleDate = { $gte: range.from, $lte: range.to };
  applyRangeFilters(query, f);
  applyAmountBounds(query, "amount", f);
  return query;
}

function paymentsMatch(f: RangeFilters, range?: DateRange | null): Record<string, unknown> {
  const query: Record<string, unknown> = {
    // Approved-only, matching `getCustomerCredits`. A pending payment has not been
    // released against a bill, so the assistant must not quote it as collected
    // money — every collection total it reports comes through this function.
    approvalStatus: "approved",
  };
  if (range) query.rcvDate = { $gte: range.from, $lte: range.to };
  applyRangeFilters(query, f);
  applyAmountBounds(query, "rcvAmount", f);
  return query;
}

function filtersFromQuery(q: ParsedQuery, kind: "sales" | "payments"): RangeFilters {
  return {
    paymentType: kind === "payments" ? q.paymentType : null,
    bankType: kind === "payments" ? q.bankType : null,
    entryBy: q.entryBy,
    assignedPerson: kind === "payments" ? q.assignedPerson : null,
    branch: kind === "payments" ? q.branch : null,
    minAmount: q.minAmount,
    maxAmount: q.maxAmount,
  };
}

function customerFilters(q: ParsedQuery, customerId: string, kind: "sales" | "payments"): RangeFilters {
  return { ...filtersFromQuery(q, kind), customerId };
}

function categoryCustomerIds(rows: CustomerCreditRow[], q: ParsedQuery): string[] | undefined {
  if (!q.category && !q.group) return undefined;
  return rows
    .filter((r) => (!q.category || (r.category ?? "") === q.category) && (!q.group || r.group === q.group))
    .map((r) => r.customerId);
}

function withCategoryScope(f: RangeFilters, rows: CustomerCreditRow[], q: ParsedQuery): RangeFilters {
  const ids = categoryCustomerIds(rows, q);
  if (ids) return { ...f, customerIds: ids };
  return f;
}

async function loadSalesInRange(range: DateRange | null, f: RangeFilters = {}) {
  await db();
  const query = salesMatch(f, range);
  return Sale.find(query)
    .sort({ saleDate: -1, amount: -1 })
    .limit(200)
    .select({ referenceId: 1, customerId: 1, saleDate: 1, amount: 1, entryBy: 1 })
    .lean()
    .exec();
}

async function totalSalesInRange(range: DateRange, f: RangeFilters = {}): Promise<{ sum: number; count: number }> {
  await db();
  const match = salesMatch(f, range);
  const [row] = await Sale.aggregate<{ _id: null; sum: number; count: number }>([
    { $match: match },
    { $group: { _id: null, sum: { $sum: "$amount" }, count: { $sum: 1 } } },
  ]);
  return { sum: row?.sum ?? 0, count: row?.count ?? 0 };
}

async function loadPaymentsInRange(range: DateRange | null, f: RangeFilters = {}) {
  await db();
  const query = paymentsMatch(f, range);
  return Payment.find(query)
    .sort({ rcvDate: -1, rcvAmount: -1 })
    .limit(200)
    .select({
      rcvDate: 1,
      customerId: 1,
      paymentType: 1,
      rcvAmount: 1,
      billNo: 1,
      bankType: 1,
      bankName: 1,
      branch: 1,
      entryBy: 1,
      assignedPerson: 1,
      relatedSaleReferenceId: 1,
    })
    .lean()
    .exec();
}

async function totalPaymentsInRange(range: DateRange, f: RangeFilters = {}): Promise<{ sum: number; count: number }> {
  await db();
  const match = paymentsMatch(f, range);
  const [row] = await Payment.aggregate<{ _id: null; sum: number; count: number }>([
    { $match: match },
    { $group: { _id: null, sum: { $sum: "$rcvAmount" }, count: { $sum: 1 } } },
  ]);
  return { sum: row?.sum ?? 0, count: row?.count ?? 0 };
}

function lines(...parts: string[]): string {
  return parts.filter(Boolean).join("\n");
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isMultiDayRange(r: DateRange): boolean {
  return !sameDay(r.from, r.to);
}

function firstDayOnly(r: DateRange): DateRange {
  if (!isMultiDayRange(r)) return r;
  const from = new Date(r.from);
  const to = new Date(r.from);
  to.setHours(23, 59, 59, 999);
  return { from, to, label: formatDate(from) };
}

function dayLabel(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/** Header: full-range total; note when list is limited to the first day */
function rangeTotalHeader(
  kind: "Sales" | "Collected",
  range: DateRange,
  total: number,
  count: number,
  unit: string
): string {
  const multi = isMultiDayRange(range);
  const head = `**${kind} ${range.label}: ${money(total)}** (${count} ${unit} in range)`;
  if (!multi) return head;
  return lines(head, `Showing **${dayLabel(range.from)}** only · total above is for the full range`);
}

function moreLine(shown: number, total: number): string {
  return total > shown ? `… +${total - shown} more` : "";
}

function nameOf(rows: CustomerCreditRow[], customerId: unknown): string {
  return rows.find((r) => r.customerId === String(customerId))?.name ?? "?";
}

function helpText(): string {
  const byFamily = new Map<string, string[]>();
  for (const i of INTENTS) {
    if (i.id === "greeting" || i.id === "help") continue;
    if (!byFamily.has(i.family)) byFamily.set(i.family, []);
    for (const ex of i.examples) {
      byFamily.get(i.family)!.push(`• ${ex}`);
    }
  }
  const blocks: string[] = [
    "I answer live questions from your credit data (filters from Customers / Sales / Payments / Alerts). Try:",
    "",
    ...WELCOME_EXAMPLES.map((e) => `• ${e}`),
    "",
    "Also supported:",
  ];
  for (const [family, exs] of byFamily) {
    blocks.push(`**${family}** (${exs.length})`);
    blocks.push(...exs);
    blocks.push("");
  }
  return blocks.join("\n").trim();
}

export async function answerQuery(q: ParsedQuery, user: SessionUser): Promise<string> {
  const intent = matchIntent(q);
  const viewer = { id: user.id, roles: user.roles as string[] };
  const rows = await getCustomerCredits({ viewer });
  const custMatch = q.customerHint ? findCustomers(q.customerHint, rows) : { exact: null, candidates: [] };
  const cust = custMatch.exact;

  // ——— Meta / help ———
  if (intent === "help") return helpText();
  if (intent === "greeting") {
    return lines(
      `Hi ${user.name.split(" ")[0]} — ask me about outstanding, overdue, sales, payments, or a customer.`,
      "",
      `Try: "${WELCOME_EXAMPLES[0]}"`,
      `Or type **help** for more examples.`
    );
  }
  if (intent === "help_credit_limit") {
    return lines(
      "**Credit limit here is a payment term in days**, not a money cap.",
      "A customer with term 30 must pay each sale within 30 days of its sale date.",
      "Overdue = unpaid balance on a sale past `saleDate + creditLimitDays` (FIFO payments clear oldest sales first)."
    );
  }
  if (intent === "help_overdue_calc") {
    return lines(
      "Overdue calculation:",
      "1. Due date = saleDate + customer's creditLimitDays.",
      "2. Payments apply FIFO (oldest sales first).",
      "3. For each sale still unpaid after due date → remaining amount counts as overdue.",
      "Customer overdueAmount = sum of those remainders. daysOverdue = worst (largest) days late."
    );
  }
  if (intent === "help_payment_types") {
    return lines(
      `Payment types: ${PAYMENT_TYPES.join(", ")}`,
      `Bank types: ${BANK_TYPES.join(", ")}`,
      `Categories: ${CUSTOMER_CATEGORIES.join(", ")}`
    );
  }
  if (intent === "help_sale_ref") {
    return lines(
      "Sale references use format **SALE-YYYY-NNNN** (e.g. SALE-2026-0042).",
      "Auto-generated on new sale entry unless you enter a manual ref."
    );
  }
  if (intent === "help_pending") {
    return lines(
      "**No.** New customers start as *pending approval*.",
      "Sales and payments reject non-approved customers.",
      "Only admin (or the creator viewing their own pending row) sees pending customers; admin approves from Customers."
    );
  }

  // ——— Lookups ———
  if (intent === "next_sale_ref") {
    const ref = await nextSaleReferenceId();
    return `Next sale reference: **${ref}**`;
  }

  if (intent === "sale_lookup" || intent === "sale_paid_status" || intent === "payments_for_sale") {
    if (!q.saleRef) {
      return "I need a sale reference like `SALE-2026-0042`. Example: Find SALE-2026-0042";
    }
    await db();
    const sale = await Sale.findOne({ referenceId: q.saleRef }).lean().exec();
    if (!sale) return `No sale found for **${q.saleRef}**.`;
    const row = rows.find((r) => r.customerId === String(sale.customerId));
    const customerName = row?.name ?? (await Customer.findById(sale.customerId).select({ name: 1 }).lean())?.name ?? "Unknown";

    if (intent === "payments_for_sale") {
      const pays = await Payment.find({
        relatedSaleReferenceId: q.saleRef,
        approvalStatus: "approved",
      })
        .sort({ rcvDate: 1 })
        .lean()
        .exec();
      const total = pays.reduce((s, p) => s + p.rcvAmount, 0);
      if (pays.length === 0) return `No payments linked to **${q.saleRef}**.`;
      const list = pays.slice(0, LIST_CAP).map(
        (p) =>
          `• ${formatDate(p.rcvDate)} · ${money(p.rcvAmount)} · ${p.paymentType}${p.billNo ? ` · ${p.billNo}` : ""}`
      );
      return lines(
        `Payments for **${q.saleRef}** (${customerName}):`,
        ...list,
        "",
        `Total linked: **${money(total)}** (${pays.length} payment(s))`
      );
    }

    // FIFO remaining for this sale
    await db();
    const allSales = await Sale.find({ customerId: sale.customerId })
      .sort({ saleDate: 1 })
      .select({ amount: 1, saleDate: 1, referenceId: 1 })
      .lean()
      .exec();
    const allPays = await Payment.find({ customerId: sale.customerId, approvalStatus: "approved" })
      .select({ amount: 1, rcvAmount: 1, rcvDate: 1 })
      .lean()
      .exec();
    const allocated = allocatePayments(
      allSales.map((s) => ({ amount: s.amount, saleDate: new Date(s.saleDate), referenceId: s.referenceId })),
      allPays.map((p) => ({ amount: p.rcvAmount }))
    );
    const target = allocated.find((s) => s.referenceId === q.saleRef);
    const remaining = target?.remaining ?? 0;
    const paid = (target ? target.amount - remaining : sale.amount);

    const base = lines(
      `**${sale.referenceId}**`,
      `Customer: ${customerName}`,
      `Date: ${formatDate(sale.saleDate)}`,
      `Amount: ${money(sale.amount)}`,
      sale.entryBy ? `Entry by: ${sale.entryBy}` : ""
    );

    if (intent === "sale_paid_status") {
      if (remaining <= 0.005) return lines(base, "", "Status: **Fully paid**");
      return lines(
        base,
        "",
        `Paid: ${money(paid)} · Remaining: **${money(remaining)}**`,
        "Status: **Still unpaid (partially or fully open)**"
      );
    }
    return lines(base, "", `Remaining after FIFO: ${money(remaining)}`);
  }

  if (intent === "payment_lookup") {
    await db();
    if (!q.billNo) {
      return "I need a bill number, e.g. Find payment for bill INV-1001";
    }
    const filter: Record<string, unknown> = { approvalStatus: "approved" };
    if (q.billNo) filter.billNo = q.billNo;
    const p = await Payment.findOne(filter).lean().exec();
    if (!p) return `No payment found for bill **${q.billNo}**.`;
    const row = rows.find((r) => r.customerId === String(p.customerId));
    const name = row?.name ?? "Unknown";
    return lines(
      `Payment${p.billNo ? ` **${p.billNo}**` : ""}:`,
      `Customer: ${name}`,
      `Date: ${formatDate(p.rcvDate)}`,
      `Amount: **${money(p.rcvAmount)}** · ${p.paymentType}`,
      p.bankType ? `Bank: ${p.bankType}` : "",
      p.branch ? `Branch: ${p.branch}` : "",
      p.relatedSaleReferenceId ? `Related sale: ${p.relatedSaleReferenceId}` : "",
      p.entryBy ? `Entry by: ${p.entryBy}` : ""
    );
  }

  // ——— Company totals (no customer / no special date requirement) ———
  // `outstanding` is the bills register only (sales are excluded by design), so the
  // headline here must sum the row field rather than doing `sales - collected` — that
  // shortcut would invent a third, different number.
  const totalOutstanding = rows.reduce((s, r) => s + r.outstanding, 0);
  const totalCollected = rows.reduce((s, r) => s + r.totalCollected, 0);
  const totalSales = rows.reduce((s, r) => s + r.totalSales, 0);
  const totalOverdue = rows.reduce((s, r) => s + r.overdueAmount, 0);
  const overdueRows = rows.filter((r) => r.status === "overdue");
  const withinRows = rows.filter((r) => r.status === "within");
  const avgTerms =
    rows.length > 0 ? Math.round(rows.reduce((s, r) => s + r.creditLimitDays, 0) / rows.length) : 0;

  if (intent === "outstanding_total") {
    // Wording matters: outstanding is the open pending-bill balance, so the
    // "sales - collected" phrasing would describe an arithmetic that no longer
    // produces this number.
    return lines(
      `**Total outstanding: ${money(totalOutstanding)}**`,
      `Across ${rows.length} customer(s) · open pending bills (sales ${money(totalSales)}, collected ${money(totalCollected)})`
    );
  }
  if (intent === "collected_total") {
    return `**Total collected: ${money(totalCollected)}** (all time, ${rows.length} customer(s))`;
  }
  if (intent === "sales_total" && !q.dateRange) {
    return `**Total company sales: ${money(totalSales)}** (all time)`;
  }
  if (intent === "overdue_total" || intent === "overdue_exposure") {
    return lines(
      `**Total overdue amount: ${money(totalOverdue)}**`,
      `${overdueRows.length} overdue customer(s) · ${withinRows.length} within terms`
    );
  }
  if (intent === "within_vs_overdue") {
    return lines(
      `Within terms: **${withinRows.length}** customer(s)`,
      `Overdue: **${overdueRows.length}** customer(s) · exposure **${money(totalOverdue)}**`
    );
  }
  // overdueRows / withinRows reserved for totals above; filtered lists use filterCreditRows
  if (intent === "collection_rate") {
    const rate = totalSales > 0 ? ((totalCollected / totalSales) * 100).toFixed(1) : "0.0";
    return `**Collection rate: ${rate}%** (${money(totalCollected)} / ${money(totalSales)})`;
  }
  if (intent === "avg_terms") {
    return `**Average payment term: ${avgTerms} days** across ${rows.length} customer(s)`;
  }
  if (intent === "count_customers") {
    return `**${rows.length}** customer(s) visible to you (approved + your pending).`;
  }
  if (intent === "count_overdue") {
    const matched = filterCreditRows(rows, q, "overdue");
    const fl = [q.category, q.branch, q.group ? `group ${q.group}` : null, q.minDays !== null ? `≥ ${q.minDays}d` : null]
      .filter(Boolean)
      .join(" · ");
    return lines(
      `**${matched.length}** overdue customer(s)${fl ? ` · ${fl}` : ""} · past-due **${money(matched.reduce((s, r) => s + r.overdueAmount, 0))}**`
    );
  }
  if (intent === "count_within") {
    const matched = filterCreditRows(rows, q, "within");
    const fl = [q.category, q.branch, q.group ? `group ${q.group}` : null].filter(Boolean).join(" · ");
    return `**${matched.length}** customer(s) within terms${fl ? ` · ${fl}` : ""}.`;
  }
  if (intent === "count_pending") {
    const pending = rows.filter((r) => r.approvalStatus === "pending");
    return `**${pending.length}** pending-approval customer(s) visible to you.`;
  }

  // Date-scoped company sales/payments/counts
  // Multi-day ranges: list first day only, total for the full range
  if (intent === "company_sales_range" || (intent === "sales_total" && q.dateRange)) {
    if (!q.dateRange) return "Please include a date or range, e.g. sales in August or sales this month.";
    const range = q.dateRange;
    const listRange = firstDayOnly(range);
    const f = withCategoryScope(filtersFromQuery(q, "sales"), rows, q);
    const daySales = await loadSalesInRange(listRange, f);
    const { sum, count } = await totalSalesInRange(range, f);
    const list = daySales
      .slice(0, LIST_CAP)
      .map(
        (s) =>
          `• ${s.referenceId} · ${formatDate(s.saleDate)} · ${money(s.amount)} · ${nameOf(rows, s.customerId)}${s.entryBy ? ` · ${s.entryBy}` : ""}`
      );
    return lines(
      rangeTotalHeader("Sales", range, sum, count, "sale(s)"),
      filtersLine(q, "sales"),
      ...(list.length ? list : [`(no sales on ${dayLabel(range.from)})`]),
      moreLine(Math.min(list.length, daySales.length), daySales.length)
    );
  }

  if (intent === "company_payments_range") {
    if (!q.dateRange) return "Please include a date or range, e.g. collected this month.";
    const range = q.dateRange;
    const listRange = firstDayOnly(range);
    const f = withCategoryScope(filtersFromQuery(q, "payments"), rows, q);
    const dayPays = await loadPaymentsInRange(listRange, f);
    const { sum, count } = await totalPaymentsInRange(range, f);
    const list = dayPays
      .slice(0, LIST_CAP)
      .map(
        (p) =>
          `• ${formatDate(p.rcvDate)} · ${money(p.rcvAmount)} · ${p.paymentType}${p.bankType || p.bankName ? ` · ${p.bankType ?? p.bankName}` : ""} · ${nameOf(rows, p.customerId)}`
      );
    return lines(
      rangeTotalHeader("Collected", range, sum, count, "payment(s)"),
      filtersLine(q, "payments"),
      ...(list.length ? list : [`(no collections on ${dayLabel(range.from)})`]),
      moreLine(Math.min(list.length, dayPays.length), dayPays.length)
    );
  }

  if (intent === "count_sales_range") {
    if (!q.dateRange) return "Include a period, e.g. How many sales today?";
    const f = withCategoryScope(filtersFromQuery(q, "sales"), rows, q);
    const { sum, count } = await totalSalesInRange(q.dateRange, f);
    const fl = filtersLine(q, "sales");
    return lines(`**${count}** sale(s) ${rangeLabel(q.dateRange)} · total **${money(sum)}**`, fl);
  }
  if (intent === "count_payments_range") {
    if (!q.dateRange) return "Include a period, e.g. How many payments this month?";
    const f = withCategoryScope(filtersFromQuery(q, "payments"), rows, q);
    const { sum, count } = await totalPaymentsInRange(q.dateRange, f);
    const fl = filtersLine(q, "payments");
    return lines(`**${count}** payment(s) ${rangeLabel(q.dateRange)} · total **${money(sum)}**`, fl);
  }

  if (intent === "list_sales_filtered") {
    const f = withCategoryScope(filtersFromQuery(q, "sales"), rows, q);
    const sales = await loadSalesInRange(q.dateRange, f);
    const sum = sales.reduce((s, x) => s + x.amount, 0);
    if (sales.length === 0) return `No sales match those filters${q.dateRange ? ` (${rangeLabel(q.dateRange)})` : ""}.`;
    const list = sales
      .slice(0, LIST_CAP)
      .map(
        (s) =>
          `• ${s.referenceId} · ${formatDate(s.saleDate)} · ${money(s.amount)} · ${nameOf(rows, s.customerId)}${s.entryBy ? ` · ${s.entryBy}` : ""}`
      );
    return lines(
      `**Sales ${rangeLabel(q.dateRange)}: ${money(sum)}** (${sales.length} sale(s))`,
      filtersLine(q, "sales"),
      ...list,
      moreLine(Math.min(list.length, sales.length), sales.length)
    );
  }

  if (intent === "list_payments_filtered") {
    const f = withCategoryScope(filtersFromQuery(q, "payments"), rows, q);
    const pays = await loadPaymentsInRange(q.dateRange, f);
    const sum = pays.reduce((s, p) => s + p.rcvAmount, 0);
    if (pays.length === 0) return `No payments match those filters${q.dateRange ? ` (${rangeLabel(q.dateRange)})` : ""}.`;
    const list = pays
      .slice(0, LIST_CAP)
      .map(
        (p) =>
          `• ${formatDate(p.rcvDate)} · ${money(p.rcvAmount)} · ${p.paymentType}${p.bankType || p.bankName ? ` · ${p.bankType ?? p.bankName}` : ""} · ${nameOf(rows, p.customerId)}${p.assignedPerson ? ` · → ${p.assignedPerson}` : ""}`
      );
    return lines(
      `**Payments ${rangeLabel(q.dateRange)}: ${money(sum)}** (${pays.length} payment(s))`,
      filtersLine(q, "payments"),
      ...list,
      moreLine(Math.min(list.length, pays.length), pays.length)
    );
  }

  // ——— Requires customer ———
  const customer =
    cust ??
    (!cust && q.customerHint && custMatch.candidates.length === 1
      ? custMatch.candidates[0]
      : null);

  const needCustomer = (): string | null => {
    if (customer) return null;
    if (q.customerHint && custMatch.candidates.length > 1) {
      return lines(
        `I found several customers matching **${q.customerHint}**:`,
        ...custMatch.candidates.map((c) => `• ${c.name}`),
        "",
        "Please use a more specific name."
      );
    }
    if (q.customerHint) {
      return lines(
        `Customer **${q.customerHint}** does not exist in the database.`,
        "",
        "Check the spelling or pick a name from Customers."
      );
    }
    return "Which customer? Example: What is outstanding for Rahman Trading?";
  };

  if (intent === "customer_payments_range" || intent === "customer_sales_range") {
    // Fallback: no real customer — answer company-wide for the date range
    if (!customer && q.dateRange) {
      if (intent === "customer_payments_range") {
        const range = q.dateRange;
        const listRange = firstDayOnly(range);
        const f = withCategoryScope(filtersFromQuery(q, "payments"), rows, q);
        const dayPays = await loadPaymentsInRange(listRange, f);
        const { sum, count } = await totalPaymentsInRange(range, f);
        const list = dayPays
          .slice(0, LIST_CAP)
          .map(
            (p) =>
              `• ${formatDate(p.rcvDate)} · ${money(p.rcvAmount)} · ${p.paymentType} · ${nameOf(rows, p.customerId)}`
          );
        return lines(
          rangeTotalHeader("Collected", range, sum, count, "payment(s)"),
          filtersLine(q, "payments"),
          ...(list.length ? list : [`(no collections on ${dayLabel(range.from)})`]),
          moreLine(Math.min(list.length, dayPays.length), dayPays.length)
        );
      }
      const range = q.dateRange;
      const listRange = firstDayOnly(range);
      const f = withCategoryScope(filtersFromQuery(q, "sales"), rows, q);
      const daySales = await loadSalesInRange(listRange, f);
      const { sum, count } = await totalSalesInRange(range, f);
      const list = daySales
        .slice(0, LIST_CAP)
        .map(
          (s) =>
            `• ${s.referenceId} · ${formatDate(s.saleDate)} · ${money(s.amount)} · ${nameOf(rows, s.customerId)}`
        );
      return lines(
        rangeTotalHeader("Sales", range, sum, count, "sale(s)"),
        filtersLine(q, "sales"),
        ...(list.length ? list : [`(no sales on ${dayLabel(range.from)})`]),
        moreLine(Math.min(list.length, daySales.length), daySales.length)
      );
    }
  }

  if (intent === "customer_sales_range") {
    if (!customer) return needCustomer() ?? "Which customer?";
    if (!q.dateRange) {
      return lines(
        `Which date for **${customer.name}**?`,
        `Example: ${customer.name} on 19 July — what was the sale?`,
        `Or: ${customer.name} sales last month`
      );
    }
    const range = q.dateRange;
    const listRange = firstDayOnly(range);
    const f = customerFilters(q, customer.customerId, "sales");
    const daySales = await loadSalesInRange(listRange, f);
    const { sum, count } = await totalSalesInRange(range, f);
    if (count === 0) {
      return `No sales for **${customer.name}** on ${rangeLabel(range)}.`;
    }
    const list = daySales
      .slice(0, LIST_CAP)
      .map(
        (s) =>
          `• ${s.referenceId} · ${formatDate(s.saleDate)} · **${money(s.amount)}**`
      );
    return lines(
      `**${customer.name}** — sales ${range.label}`,
      `Count: ${count} · Total: **${money(sum)}**${isMultiDayRange(range) ? ` (full range) · showing **${dayLabel(range.from)}** only` : ""}`,
      filtersLine(q, "sales"),
      ...(list.length ? list : [`(no sales on ${dayLabel(range.from)})`]),
      moreLine(Math.min(list.length, daySales.length), daySales.length)
    );
  }

  if (intent === "customer_payments_range") {
    if (!customer) return needCustomer() ?? "Which customer?";
    if (!q.dateRange) {
      return `Which date range for payments from **${customer.name}**? Example: payments from ${customer.name} this week`;
    }
    const range = q.dateRange;
    const listRange = firstDayOnly(range);
    const f = customerFilters(q, customer.customerId, "payments");
    const dayPays = await loadPaymentsInRange(listRange, f);
    const { sum, count } = await totalPaymentsInRange(range, f);
    if (count === 0) return `No payments from **${customer.name}** ${rangeLabel(range)}.`;
    const list = dayPays
      .slice(0, LIST_CAP)
      .map(
        (p) =>
          `• ${formatDate(p.rcvDate)} · **${money(p.rcvAmount)}** · ${p.paymentType}${p.billNo ? ` · ${p.billNo}` : ""}`
      );
    return lines(
      `**${customer.name}** — payments ${range.label}`,
      `Count: ${count} · Total: **${money(sum)}**${isMultiDayRange(range) ? ` (full range) · showing **${dayLabel(range.from)}** only` : ""}`,
      filtersLine(q, "payments"),
      ...(list.length ? list : [`(no payments on ${dayLabel(range.from)})`]),
      moreLine(Math.min(list.length, dayPays.length), dayPays.length)
    );
  }

  if (intent === "customer_payment_types" || intent === "customer_banks") {
    if (!customer) return needCustomer() ?? "Which customer?";
    await db();
    const pays = await Payment.find({ customerId: customer.customerId, approvalStatus: "approved" })
      .select({ paymentType: 1, bankType: 1, bankName: 1, rcvAmount: 1, rcvDate: 1 })
      .lean()
      .exec();
    if (pays.length === 0) return `No payments recorded for **${customer.name}** yet.`;

    if (intent === "customer_payment_types") {
      const map = new Map<string, { count: number; total: number }>();
      for (const p of pays) {
        const key = p.paymentType || "Other";
        const e = map.get(key) ?? { count: 0, total: 0 };
        e.count += 1;
        e.total += p.rcvAmount;
        map.set(key, e);
      }
      const entries = [...map.entries()].sort((a, b) => b[1].count - a[1].count || b[1].total - a[1].total);
      return lines(
        `**${customer.name}** — payment types used (${pays.length} payment(s)):`,
        ...entries.map(([k, v]) => `• ${k}: ${v.count}× · ${money(v.total)}`)
      );
    }

    const map = new Map<string, { count: number; total: number }>();
    for (const p of pays) {
      const key = p.bankType || p.bankName || "Cash / Other";
      const e = map.get(key) ?? { count: 0, total: 0 };
      e.count += 1;
      e.total += p.rcvAmount;
      map.set(key, e);
    }
    const entries = [...map.entries()].sort((a, b) => b[1].count - a[1].count || b[1].total - a[1].total);
    return lines(
      `**${customer.name}** — banks used (${pays.length} payment(s)):`,
      ...entries.map(([k, v]) => `• ${k}: ${v.count}× · ${money(v.total)}`)
    );
  }

  if (intent === "customer_contact") {
    if (!customer) return needCustomer() ?? "Which customer?";
    return lines(
      `**${customer.name}**`,
      `Contact person: ${customer.contactPerson ?? "—"}`,
      `Phone: ${customer.contactNumber ?? "—"}`,
      `Address: ${customer.address ?? "—"}`
    );
  }
  if (intent === "customer_terms") {
    if (!customer) return needCustomer() ?? "Which customer?";
    return `**${customer.name}** payment term: **${customer.creditLimitDays} days** (credit limit = days to pay, not money).`;
  }
  if (intent === "customer_category_branch") {
    if (!customer) return needCustomer() ?? "Which customer?";
    return lines(
      `**${customer.name}**`,
      `Category: ${customer.category ?? "Uncategorized"}`,
      `Group: ${customer.group}`,
      `Branch: ${customer.branch ?? "—"}`
    );
  }
  if (intent === "customer_oldest_overdue") {
    if (!customer) return needCustomer() ?? "Which customer?";
    if (customer.status !== "overdue" || !customer.oldestOverdueDate) {
      return `**${customer.name}** has no overdue unpaid sales.`;
    }
    return lines(
      `**${customer.name}** oldest unpaid past-due sale: **${formatDate(customer.oldestOverdueDate)}**`,
      `Overdue: ${money(customer.overdueAmount)} · ${customer.daysOverdue} day(s) late`
    );
  }
  if (intent === "customer_overdue_detail") {
    if (!customer) return needCustomer() ?? "Which customer?";
    if (customer.status !== "overdue") {
      return `**${customer.name}** is within terms (0 days overdue).`;
    }
    return lines(
      `**${customer.name}**`,
      `Status: **Overdue ${customer.daysOverdue} day(s)**`,
      `Overdue amount: ${money(customer.overdueAmount)}`,
      `Term: ${customer.creditLimitDays} days · Outstanding: ${money(customer.outstanding)}`
    );
  }
  if (intent === "customer_status") {
    if (!customer) return needCustomer() ?? "Which customer?";
    if (customer.status === "overdue") {
      return lines(
        `**${customer.name}** is **OVERDUE**`,
        `${money(customer.overdueAmount)} past due · ${customer.daysOverdue} day(s) beyond ${customer.creditLimitDays}-day term`
      );
    }
    return `**${customer.name}** is **within terms** (outstanding ${money(customer.outstanding)}).`;
  }
  if (intent === "customer_outstanding") {
    if (!customer) return needCustomer() ?? "Which customer?";
    return lines(
      `**${customer.name}**`,
      `Outstanding: **${money(customer.outstanding)}**`,
      `Sales: ${money(customer.totalSales)} · Collected: ${money(customer.totalCollected)}`,
      customer.status === "overdue"
        ? `Of which overdue: ${money(customer.overdueAmount)} (${customer.daysOverdue}d late)`
        : `Status: within terms`
    );
  }
  if (intent === "customer_collected") {
    if (!customer) return needCustomer() ?? "Which customer?";
    return `**${customer.name}** has paid **${money(customer.totalCollected)}** total (sales ${money(customer.totalSales)}, outstanding ${money(customer.outstanding)}).`;
  }
  if (intent === "customer_sales_total") {
    if (!customer) return needCustomer() ?? "Which customer?";
    if (q.dateRange) {
      const f = customerFilters(q, customer.customerId, "sales");
      const sales = await loadSalesInRange(q.dateRange, f);
      const sum = sales.reduce((s, x) => s + x.amount, 0);
      return `**${customer.name}** sales ${rangeLabel(q.dateRange)}: **${money(sum)}** (${sales.length} sale(s))`;
    }
    return `**${customer.name}** total sales: **${money(customer.totalSales)}** · collected ${money(customer.totalCollected)} · outstanding ${money(customer.outstanding)}.`;
  }
  if (intent === "customer_search") {
    const hint = q.customerHint ?? "";
    if (!hint) return "Which customer name should I search?";
    const hits = rows.filter((r) => r.name.toLowerCase().includes(hint.toLowerCase()));
    if (hits.length === 0) return `No customers matching **${hint}**.`;
    return lines(
      `Customers matching **${hint}** (${hits.length}):`,
      ...hits.slice(0, LIST_CAP).map((r) => `• ${r.name} — outstanding ${money(r.outstanding)}${r.status === "overdue" ? " (overdue)" : ""}`)
    );
  }
  if (intent === "customer_profile") {
    if (!customer) return needCustomer() ?? "Which customer?";
    const overdueLine =
      customer.status === "overdue"
        ? `Overdue: **${money(customer.overdueAmount)}** · ${customer.daysOverdue} day(s) late`
        : `Overdue: none (within terms)`;

    const periodLines: string[] = [];
    if (q.dateRange) {
      const wantsCollection = /\bcollection\b|\bcollections\b|\bcollected\b|\bpayments?\b|\bpaid\b|\breceived\b/.test(q.lower);
      const wantsSales = /\bsales?\b|\bsold\b|\bpurchase\b|\bbought\b/.test(q.lower);
      const showBoth = wantsCollection === wantsSales;
      if (wantsCollection || showBoth) {
        const { sum, count } = await totalPaymentsInRange(q.dateRange, {
          customerId: customer.customerId,
        });
        periodLines.push(`Collection ${q.dateRange.label}: **${money(sum)}** (${count} payment(s))`);
      }
      if (wantsSales || showBoth) {
        const { sum, count } = await totalSalesInRange(q.dateRange, {
          customerId: customer.customerId,
        });
        periodLines.push(`Sales ${q.dateRange.label}: **${money(sum)}** (${count} sale(s))`);
      }
    }

    return lines(
      `**About ${customer.name}**`,
      ...periodLines,
      ...(periodLines.length ? ["", "Lifetime:"] : []),
      `Total sales: **${money(customer.totalSales)}**`,
      `Total collection (payments): **${money(customer.totalCollected)}**`,
      `Outstanding: **${money(customer.outstanding)}**`,
      overdueLine,
      `Term: ${customer.creditLimitDays} days · Status: ${
        customer.status === "overdue" ? `**Overdue ${customer.daysOverdue}d**` : "within terms"
      }`,
      `Category: ${customer.category ?? "Uncategorized"} · Branch: ${customer.branch ?? "—"}`,
      `Contact: ${customer.contactPerson ?? "—"} ${customer.contactNumber ?? "—"}`
    );
  }

  // ——— Lists / alerts ———
  if (intent === "list_overdue_min_days" || intent === "list_overdue") {
    const matched = filterCreditRows(rows, q, "overdue").sort(
      (a, b) => b.overdueAmount - a.overdueAmount || b.daysOverdue - a.daysOverdue
    );
    const min = q.minDays;
    const title =
      intent === "list_overdue_min_days" && min !== null
        ? `Overdue **more than ${min} days** (${matched.length})`
        : `Overdue customers (${matched.length})`;
    const fl = [
      q.category,
      q.branch,
      q.group ? `group ${q.group}` : null,
      min !== null ? `≥ ${min}d` : null,
      q.minAmount !== null ? `outstanding ≥ ${money(q.minAmount)}` : null,
      q.maxAmount !== null ? `outstanding ≤ ${money(q.maxAmount)}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    if (matched.length === 0) return `No customers match${fl ? ` (${fl})` : " those filters"}.`;
    return lines(
      `${title}${fl ? ` · ${fl}` : ""}:`,
      ...matched.slice(0, LIST_CAP).map(
        (r) =>
          `• ${r.name} — ${money(r.overdueAmount)} · ${r.daysOverdue}d · outstanding ${money(r.outstanding)}${r.branch ? ` · ${r.branch}` : ""}${r.category ? ` · ${r.category}` : ""}`
      ),
      matched.length > LIST_CAP ? `… +${matched.length - LIST_CAP} more` : "",
      `Exposure: **${money(matched.reduce((s, r) => s + r.overdueAmount, 0))}**`
    );
  }
  if (intent === "list_within") {
    const list = filterCreditRows(rows, q, "within").sort((a, b) => b.outstanding - a.outstanding);
    if (list.length === 0) return "No customers within terms.";
    return lines(
      `Within terms (${list.length})${q.category ? ` · ${q.category}` : ""}${q.branch ? ` · ${q.branch}` : ""}:`,
      ...list.slice(0, LIST_CAP).map((r) => `• ${r.name} — outstanding ${money(r.outstanding)}`),
      list.length > LIST_CAP ? `… +${list.length - LIST_CAP} more` : ""
    );
  }
  if (intent === "list_customers_filtered") {
    const list = filterCreditRows(rows, q);
    list.sort((a, b) => a.name.localeCompare(b.name));
    const fl = filterBits(q, "payments").filter((b) => !["≥ 0d overdue"].includes(b));
    if (list.length === 0) return `No customers match${fl.length ? ` (${fl.join(" · ")})` : " those filters"}.`;
    return lines(
      `Customers (${list.length})${fl.length ? ` · ${fl.join(" · ")}` : ""}:`,
      ...list.slice(0, LIST_CAP).map(
        (r) =>
          `• ${r.name} — ${r.category ?? "—"}${r.branch ? ` · ${r.branch}` : ""} · outstanding ${money(r.outstanding)}${r.status === "overdue" ? ` (overdue ${r.daysOverdue}d)` : ""} · ${r.approvalStatus}`
      ),
      list.length > LIST_CAP ? `… +${list.length - LIST_CAP} more` : ""
    );
  }
  if (intent === "list_pending_customers") {
    const list = rows
      .filter((r) => r.approvalStatus === "pending")
      .filter((r) => (!q.category || (r.category ?? "") === q.category))
      .filter((r) => (!q.branch || r.branch === q.branch))
      .filter((r) => !q.group || r.group === q.group)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (list.length === 0) return "No pending-approval customers visible to you.";
    return lines(
      `Pending approval (${list.length}):`,
      ...list.slice(0, LIST_CAP).map(
        (r) => `• ${r.name} — ${r.category ?? "—"}${r.branch ? ` · ${r.branch}` : ""}${r.createdByName ? ` · by ${r.createdByName}` : ""}`
      ),
      list.length > LIST_CAP ? `… +${list.length - LIST_CAP} more` : "",
      "",
      "Admin can approve from Customers."
    );
  }

  // ——— Rankings ———
  if (intent === "top_customers") {
    const n = q.topN ?? 5;
    let metric: keyof CustomerCreditRow = "overdueAmount";
    let label = "overdue amount";
    if (/\boutstanding\b/.test(q.lower)) {
      metric = "outstanding";
      label = "outstanding";
    } else if (/\bsales?\b/.test(q.lower) && !/\boverdue\b/.test(q.lower)) {
      metric = "totalSales";
      label = "total sales";
    } else if (/\bcollect|paid\b/.test(q.lower)) {
      metric = "totalCollected";
      label = "collected";
    } else if (/\bdays\b/.test(q.lower)) {
      metric = "daysOverdue";
      label = "days overdue";
    }
    const pool = filterCreditRows(rows, q, /\boverdue\b/.test(q.lower) && !/\bwithin\b/.test(q.lower) ? "overdue" : undefined);
    const sorted = [...pool].sort(
      (a, b) => Number(b[metric] ?? 0) - Number(a[metric] ?? 0)
    );
    const top = sorted.slice(0, n).filter((r) => Number(r[metric] ?? 0) > 0);
    if (top.length === 0) return `No customers with ${label} > 0.`;
    const fl = [q.category, q.branch, q.group ? `group ${q.group}` : null].filter(Boolean).join(" · ");
    return lines(
      `Top **${top.length}** by **${label}**${fl ? ` · ${fl}` : ""}:`,
      ...top.map((r, i) => {
        const v = Number(r[metric] ?? 0);
        const display = metric === "daysOverdue" ? `${v}d` : money(v);
        return `${i + 1}. ${customerHeader(r)} — ${display}${r.category ? ` · ${r.category}` : ""}`;
      })
    );
  }
  if (intent === "largest_sale") {
    await db();
    const s = await Sale.findOne().sort({ amount: -1 }).lean().exec();
    if (!s) return "No sales recorded yet.";
    const name = rows.find((r) => r.customerId === String(s.customerId))?.name ?? "?";
    return lines(
      `**Largest sale: ${money(s.amount)}**`,
      `${s.referenceId} · ${formatDate(s.saleDate)} · ${name}`
    );
  }
  if (intent === "largest_payment") {
    await db();
    const p = await Payment.findOne({ approvalStatus: "approved" })
      .sort({ rcvAmount: -1 })
      .lean()
      .exec();
    if (!p) return "No payments recorded yet.";
    const name = rows.find((r) => r.customerId === String(p.customerId))?.name ?? "?";
    return lines(
      `**Largest payment: ${money(p.rcvAmount)}**`,
      `${formatDate(p.rcvDate)} · ${p.paymentType} · ${name}`,
      p.billNo ? `Bill: ${p.billNo}` : ""
    );
  }
  if (intent === "newest_sales") {
    await db();
    const n = q.topN ?? 5;
    const sales = await Sale.find().sort({ saleDate: -1, createdAt: -1 }).limit(n).lean().exec();
    const nameMap = new Map(rows.map((r) => [r.customerId, r.name]));
    return lines(
      `Newest ${sales.length} sale(s):`,
      ...sales.map(
        (s) =>
          `• ${s.referenceId} · ${formatDate(s.saleDate)} · ${money(s.amount)} · ${nameMap.get(String(s.customerId)) ?? "?"}`
      )
    );
  }
  if (intent === "newest_payments") {
    await db();
    const n = q.topN ?? 5;
    const pays = await Payment.find({ approvalStatus: "approved" })
      .sort({ rcvDate: -1, createdAt: -1 })
      .limit(n)
      .lean()
      .exec();
    const nameMap = new Map(rows.map((r) => [r.customerId, r.name]));
    return lines(
      `Newest ${pays.length} payment(s):`,
      ...pays.map(
        (p) =>
          `• ${formatDate(p.rcvDate)} · ${money(p.rcvAmount)} · ${p.paymentType} · ${nameMap.get(String(p.customerId)) ?? "?"}`
      )
    );
  }

  // ——— Breakdowns ———
  if (intent === "breakdown_payment") {
    await db();
    const f = withCategoryScope(filtersFromQuery(q, "payments"), rows, q);
    const match = paymentsMatch(f, q.dateRange);
    const byType = await Payment.aggregate<{ _id: string | null; total: number; count: number }>([
      ...(Object.keys(match).length ? [{ $match: match }] : []),
      { $group: { _id: "$paymentType", total: { $sum: "$rcvAmount" }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]);
    const bankMatch = { ...match };
    delete bankMatch.paymentType;
    const byBank = await Payment.aggregate<{ _id: string | null; total: number; count: number }>([
      ...(Object.keys(bankMatch).length ? [{ $match: bankMatch }] : []),
      { $group: { _id: { $ifNull: ["$bankType", "Cash / Other"] }, total: { $sum: "$rcvAmount" }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]);
    const grand = byType.reduce((s, t) => s + t.total, 0);
    return lines(
      `**Collections by payment type** ${q.dateRange ? q.dateRange.label : "all time"}`,
      filtersLine(q, "payments"),
      `Grand total: **${money(grand)}**`,
      "",
      ...byType.map((t) => `• ${t._id ?? "Other"}: ${money(t.total)} (${t.count})`),
      "",
      "**By bank type**",
      ...byBank.map((b) => `• ${b._id ?? "Other"}: ${money(b.total)} (${b.count})`)
    );
  }
  if (intent === "breakdown_sales_entry") {
    await db();
    const f = withCategoryScope(filtersFromQuery(q, "sales"), rows, q);
    const match = salesMatch(f, q.dateRange);
    const byEntry = await Sale.aggregate<{ _id: string | null; total: number; count: number }>([
      ...(Object.keys(match).length ? [{ $match: match }] : []),
      { $group: { _id: "$entryBy", total: { $sum: "$amount" }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]);
    if (byEntry.length === 0) return "No sales to group.";
    return lines(
      `**Sales by entryBy** ${q.dateRange ? q.dateRange.label : "all time"}`,
      filtersLine(q, "sales"),
      ...byEntry.map((e) => `• ${e._id ?? "—"}: ${money(e.total)} (${e.count} sales)`)
    );
  }
  if (intent === "breakdown_credit") {
    let dim: "category" | "branch" | "group" = "category";
    if (/\bbranch\b/.test(q.lower)) dim = "branch";
    else if (/\bgroup\b/.test(q.lower)) dim = "group";
    const pool = filterCreditRows(rows, q);
    const map = new Map<string, { count: number; outstanding: number; overdue: number; overCount: number }>();
    for (const r of pool) {
      const key = (dim === "category" ? r.category : dim === "branch" ? r.branch : r.group) || "Uncategorized";
      const e = map.get(key) ?? { count: 0, outstanding: 0, overdue: 0, overCount: 0 };
      e.count += 1;
      e.outstanding += r.outstanding;
      e.overdue += r.overdueAmount;
      if (r.status === "overdue") e.overCount += 1;
      map.set(key, e);
    }
    const entries = [...map.entries()].sort((a, b) => b[1].outstanding - a[1].outstanding);
    if (entries.length === 0) return "No customers to group.";
    return lines(
      `**Outstanding by ${dim}**`,
      ...entries.map(
        ([k, v]) =>
          `• ${k}: outstanding ${money(v.outstanding)} · ${v.count} customer(s) · ${v.overCount} overdue (${money(v.overdue)})`
      )
    );
  }

  // Fallback — if customer known, give profile summary
  if (customer) {
    return lines(
      `**${customer.name}** summary`,
      `Outstanding: ${money(customer.outstanding)} · Overdue: ${money(customer.overdueAmount)}${customer.status === "overdue" ? ` (${customer.daysOverdue}d)` : ""}`,
      `Sales: ${money(customer.totalSales)} · Collected: ${money(customer.totalCollected)}`,
      `Term: ${customer.creditLimitDays} days · ${customer.category ?? "Uncategorized"} / ${customer.branch ?? "—"}`,
      "",
      "Type **help** for more question examples."
    );
  }

  return lines(
    "I didn't quite get that.",
    "",
    `Try: "${WELCOME_EXAMPLES[0]}"`,
    "Or type **help** for a full list of questions I can answer."
  );
}
