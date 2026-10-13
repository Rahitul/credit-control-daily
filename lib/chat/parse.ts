import { parseDateRange, type DateRange } from "@/lib/chat/dates";

export type ParsedQuery = {
  raw: string;
  lower: string;
  dateRange: DateRange | null;
  customerHint: string | null;
  saleRef: string | null;
  billNo: string | null;
  topN: number | null;
  minDays: number | null;
  minAmount: number | null;
  maxAmount: number | null;
  category: string | null;
  branch: string | null;
  group: string | null;
  paymentType: string | null;
  bankType: string | null;
  entryBy: string | null;
  assignedPerson: string | null;
  approval: "pending" | "approved" | null;
  status: "overdue" | "within" | null;
};

export function normalizeText(input: string): string {
  return input
    .replace(/[৳]/g, "")
    .replace(/,/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseQuery(rawInput: string, now = new Date()): ParsedQuery {
  const raw = rawInput.trim();
  const lower = raw.toLowerCase();

  const dateRange = parseDateRange(raw, now);

  // SALE-YYYY-NNNN
  const saleRefMatch = raw.match(/\bSALE-\d{4}-\d{3,6}\b/i);
  const saleRef = saleRefMatch ? saleRefMatch[0].toUpperCase() : null;

  // Bill numbers like INV-1001, bill 778, billno INV-1
  let billNo: string | null = null;
  const billWord = lower.match(/\bbill(?:\s*(?:no|number|#))?\s+([a-z0-9-]+)\b/);
  if (billWord) billNo = billWord[1].toUpperCase();
  const invLike = raw.match(/\b(INV|BL|BILL)-[A-Z0-9]+\b/i);
  if (invLike && !billNo) billNo = invLike[0].toUpperCase();

  // top N
  let topN: number | null = null;
  const topMatch = lower.match(/\b(?:top|first|show|give me)\s+(\d{1,3})\b/);
  if (topMatch) topN = Math.min(Number(topMatch[1]), 50);
  else if (/\bbiggest\b|\blargest\b|\bmost\b|\bhighest\b|\btop\b/.test(lower) && !topN) {
    topN = 5;
  }

  // more than N days
  const minDaysMatch = lower.match(
    /\b(?:more than|over|above|greater than|>)\s+(\d{1,4})\s*days?\b/
  ) || lower.match(/\b(\d{1,4})\s*\+?\s*days?\s+(?:overdue|late|past)\b/);
  const minDays = minDaysMatch ? Number(minDaysMatch[1]) : null;

  // amount thresholds: "over 100000", "over 50k", "৳900" (bare needs 3+ digits so "over 30 days" stays minDays)
  const minAmountWithUnit = lower.match(
    /\b(?:over|above|more than|greater than|>)\s*৳?\s*(\d{1,4})\s*(k|lakh|lac)\b/
  );
  const minAmountBare = lower.match(
    /\b(?:over|above|more than|greater than|>)\s*৳?\s*(\d{3,})\b/
  ) || lower.match(/\b৳\s*(\d{3,})\b/);
  let minAmount: number | null = null;
  if (minAmountWithUnit) {
    const n = Number(minAmountWithUnit[1]);
    minAmount = minAmountWithUnit[2] === "k" ? n * 1000 : n * 100000;
  } else if (minAmountBare) {
    minAmount = Number(minAmountBare[1]);
  }

  // max amount: "under 50000", "below ৳100k", "max 20000"
  const maxWithUnit = lower.match(
    /\b(?:under|below|max(?:imum)?|up to|less than|at most)\s*৳?\s*(\d{1,4})\s*(k|lakh|lac)\b/
  );
  const maxBare = lower.match(
    /\b(?:under|below|max(?:imum)?|up to|less than|at most)\s*৳?\s*(\d{3,})\b/
  );
  let maxAmount: number | null = null;
  if (maxWithUnit) {
    const n = Number(maxWithUnit[1]);
    maxAmount = maxWithUnit[2] === "k" ? n * 1000 : n * 100000;
  } else if (maxBare) {
    maxAmount = Number(maxBare[1]);
  }

  // category / branch / payment type / bank (known tokens)
  let category: string | null = null;
  for (const c of ["retail", "wholesale", "corporate", "government", "distributor", "other"]) {
    if (new RegExp(`\\b${c}\\b`).test(lower)) {
      category = c.charAt(0).toUpperCase() + c.slice(1);
      if (c === "other") category = "Other";
      break;
    }
  }

  let branch: string | null = null;
  for (const b of ["dhaka", "chattogram", "chittagong", "sylhet", "khulna"]) {
    if (new RegExp(`\\b${b}\\b`).test(lower)) {
      branch =
        b === "chattogram" || b === "chittagong"
          ? "Chattogram"
          : b.charAt(0).toUpperCase() + b.slice(1);
      break;
    }
  }

  let paymentType: string | null = null;
  for (const p of ["cash", "cheque", "check", "bkash", "nagad", "bank transfer", "card"]) {
    if (lower.includes(p)) {
      paymentType =
        p === "check" ? "Cheque" : p === "bkash" ? "bKash" : p === "bank transfer" ? "Bank Transfer"
        : p.charAt(0).toUpperCase() + p.slice(1);
      break;
    }
  }

  let bankType: string | null = null;
  for (const b of ["city bank", "brac bank", "ebl", "dbbl", "ibbl"]) {
    if (lower.includes(b)) {
      bankType =
        b === "city bank" ? "City Bank"
        : b === "brac bank" ? "BRAC Bank"
        : b.toUpperCase();
      break;
    }
  }
  if (!bankType && /\bother bank\b|\bbank other\b/.test(lower)) bankType = "Other";

  // approval list: "pending customers", "approved only"
  let approval: "pending" | "approved" | null = null;
  if (/\bpending\b/.test(lower) && /\bcustomer|approval|awaiting\b/.test(lower)) approval = "pending";
  else if (/\bapproved\b/.test(lower) && /\bcustomer|only\b/.test(lower)) approval = "approved";

  // customer group: "in group X", "group X"
  let group: string | null = null;
  const groupMatch = raw.match(
    /\b(?:in\s+group|group(?:\s+of\s+company)?|grouped(?:\s+in)?)\s+(?:the\s+)?([A-Za-z][A-Za-z0-9&'\s.-]{2,50})\b/i
  );
  if (groupMatch && !/\bbreakdown\b|\bby group\b|\bgroup breakdown\b/i.test(raw)) {
    group = groupMatch[1]
      .trim()
      .replace(/\s+(customers?|list|show|who|that|which|overdue|within)\b.*$/i, "")
      .trim();
    if (group.length < 2) group = null;
  }

  // assigned person (payments): "assigned to X"
  let assignedPerson: string | null = null;
  const assignMatch = raw.match(/\bassigned(?:\s+to)?\s+([A-Za-z][A-Za-z\s'.-]{2,40})\b/i);
  if (assignMatch) {
    assignedPerson = assignMatch[1]
      .trim()
      .replace(/\s+(today|tomorrow|yesterday|this\s+(?:day|week|month|year)|last\s+(?:day|week|month|year)|on|in|for|payment|payments|during)$/i, "")
      .trim();
    if (assignedPerson.length < 2) assignedPerson = null;
  }

  const knownFilterVocab = new Set([
    ...PAYMENT_TYPE_TOKENS,
    ...BANK_TYPE_TOKENS,
    ...["retail", "wholesale", "corporate", "government", "distributor", "other",
      "dhaka", "chattogram", "chittagong", "sylhet", "khulna",
      "today", "yesterday", "this", "last", "month", "week", "year", "all", "any",
      "the", "a", "an", "customers", "customer", "payments", "sales"],
  ]);

  let entryBy: string | null = null;
  const entryMatch = raw.match(/\b(?:entered by|entry by|recorded by|by)\s+([A-Za-z][A-Za-z\s'.-]{2,40})\b/i);
  if (entryMatch) {
    entryBy = entryMatch[1]
      .trim()
      .replace(/\s+(today|tomorrow|yesterday|this\s+(?:day|week|month|year)|last\s+(?:day|week|month|year)|on|in|for|payment|payments|during)$/i, "")
      .trim();
    const firstWord = entryBy.split(/\s+/)[0] ?? "";
    if (knownFilterVocab.has(entryBy.toLowerCase()) || knownFilterVocab.has(firstWord.toLowerCase())) entryBy = null;
    else if (entryBy.length < 2) entryBy = null;
  }

  let status: "overdue" | "within" | null = null;
  if (/\boverdue\b|\bpast due\b|\blate\b|\bpast their\b/.test(lower)) status = "overdue";
  else if (/\bwithin\b|\bcurrent\b|\bnot overdue\b|\bon time\b|\bgood\b/.test(lower)) status = "within";

  // Customer name hint: strip known question words / metrics, keep capitalized sequences + leftovers
  const customerHint = extractCustomerHint(raw, lower, {
    saleRef,
    billNo,
    dateRange,
  });

  return {
    raw,
    lower,
    dateRange,
    customerHint,
    saleRef,
    billNo,
    topN,
    minDays,
    minAmount,
    maxAmount,
    category,
    branch,
    group,
    paymentType,
    bankType,
    entryBy,
    assignedPerson,
    approval,
    status,
  };
}

const PAYMENT_TYPE_TOKENS = ["cash", "cheque", "check", "bkash", "nagad", "bank transfer", "card"];
const BANK_TYPE_TOKENS = ["city bank", "brac bank", "ebl", "dbbl", "ibbl"];

function extractCustomerHint(
  raw: string,
  lower: string,
  ctx: { saleRef: string | null; billNo: string | null; dateRange: DateRange | null }
): string | null {
  let work = raw;

  if (ctx.saleRef) work = work.replace(new RegExp(ctx.saleRef, "ig"), " ");
  if (ctx.billNo) work = work.replace(new RegExp(ctx.billNo.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"), "ig"), " ");

  // Strip assigned-to / entry-by phrases so the person name is not a "customer"
  work = work.replace(/\bassigned(?:\s+to)?\s+[A-Za-z][A-Za-z\s'.-]{2,40}/gi, " ");
  work = work.replace(/\b(?:entered by|entry by|recorded by)\s+[A-Za-z][A-Za-z\s'.-]{2,40}/gi, " ");

  // Always strip date/period phrases so they never become a "customer name"
  work = work.replace(
    /\b(today|yesterday|tomorrow|tmr|this week|last week|previous week|prior week|this month|last month|previous month|prior month|ytd|this year|last year|previous year|prior year|last \d+ days|past \d+ days|current month|current week|current year|in the month|in previous|in last|in this)\b/gi,
    " "
  );
  // Explicit ranges: "1 sep to 30 sep", "from 1/9 until 30/9"
  work = work.replace(
    /\b(?:from\s+)?\d{1,2}\s*(?:[a-z]{3,9})?(?:\s+\d{4})?\s+(?:to|through|thru|till|until|–|—|-)\s+\d{1,2}\s*(?:[a-z]{3,9})?(?:\s+\d{4})?\b/gi,
    " "
  );
  work = work
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/g, " ")
    .replace(/\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/gi, " ")
    .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}\b/gi, " ")
    .replace(/\bin\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/gi, " ")
    .replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/gi, " ");

  // Drop leading question boilerplate
  work = work
    .replace(
      /^(what|whats|what's|how|how much|how many|which|who|tell me|tell|show me|show|give me|give|list|find|search|please|ok|okay|all|about|overview|summary)[\s,]+/i,
      " "
    )
    .replace(
      /^(tell me about|tell me|show me about|show me|give me|about)\b[\s,]*/i,
      " "
    )
    .replace(
      /\b(is|are|was|were|do|does|did|did the|the|a|an|our|we|my|me|i want to know|want to know|about|for|of|in|on|at|to|and|that|this|with|have|has|had|tell|tells|telling)\b/gi,
      " "
    );

  // Capitalized multi-word phrases — run on work (dates already stripped), keep original case
  const caps = work.match(/\b([A-Z][A-Za-z0-9&'.-]*(?:\s+[A-Za-z0-9&'.-]*){0,6})\b/g);
  const stopCaps = new Set([
    "What", "What's", "Whats", "How", "How much", "How many", "Which", "Who",
    "The", "Our", "Show", "List", "Find", "Sale", "Sales", "Payment", "Payments",
    "Top", "Today", "Yesterday", "Total", "Customer", "Customers", "Bill",
    "SALE", "Please", "Give", "Tell", "About", "I", "Is", "Are", "Do", "Does", "Did",
    "Many", "Much", "Dhaka", "Chattogram", "Previous", "Last", "This", "Current",
    "Month", "Week", "Year", "Collected", "Outstanding", "Overdue", "Company",
    "Cash", "Cheque", "Check", "bKash", "Nagad", "Card", "Bank", "Transfer",
    "Retail", "Wholesale", "Corporate", "Government", "Distributor",
  ]);
  if (caps) {
    const phrase = caps
      .map((c) => c.trim())
      .find((c) => {
        const first = c.split(/\s+/)[0];
        if (stopCaps.has(first)) return false;
        if (/^(SALE|INV)-/i.test(c)) return false;
        if (/^\d/.test(c)) return false;
        const cleaned = c.toLowerCase();
        if (
          cleaned === "outstanding" ||
          cleaned === "overdue" ||
          cleaned === "collected" ||
          cleaned === "payment type" ||
          cleaned === "bank type" ||
          cleaned === "previous month" ||
          cleaned === "last month" ||
          cleaned === "this month"
        ) {
          return false;
        }
        return /[a-z]{2,}/i.test(c);
      });
    if (phrase && phrase.replace(/\s+/g, " ").trim().length >= 2) {
      const trimmed = phrase
        .replace(/\s+/g, " ")
        .trim()
        .replace(
          /(?:\s+\b(?:use|used|using|pay|paid|pays|usually|often|always|collection|collections|collected|total|payment|payments|outstanding|balance|sales|sale|amount|status|overdue|within|terms|dues|owing|owe|how|much|many|for|of|the|a|an|and|or|to|in|on|at|by|with|from|this|that|these|those)\b)+\s*$/i,
          ""
        )
        .trim();
      if (trimmed.length >= 2) return trimmed;
      return phrase.replace(/\s+/g, " ").trim();
    }
  }

  // Fallback: leftover content words (preserve original casing)
  const metrics = new Set([
    "outstanding", "overdue", "collected", "collection", "total", "sales", "sale",
    "payments", "payment", "customer", "customers", "amount", "days", "day",
    "within", "terms", "status", "how", "many", "much", "what", "which", "who",
    "is", "are", "the", "our", "we", "please", "show", "list", "find", "top",
    "breakdown", "by", "category", "branch", "group", "bank", "type", "today",
    "month", "week", "year", "ytd", "date", "on", "in", "for", "of", "and",
    "contact", "phone", "person", "address", "term", "terms", "credit", "limit",
    "biggest", "largest", "most", "highest", "pending", "approved", "count",
    "number", "when", "was", "were", "did", "does", "have", "has",
    "previous", "prior", "last", "this", "current", "past", "recent", "recently",
    "month's", "week's", "year's", "we", "us", "all", "any", "every", "each",
    "been", "be", "will", "would", "should", "could", "from",
    "received", "receive", "money", "bdt", "tk", "taka", "now",
    "between", "during", "across", "overall", "company", "business", "team",
    "collect", "collected", "collection", "collections", "paid", "pay", "pays",
    "bought", "sold", "purchase", "purchases", "recorded", "showing", "gave",
    "give", "gives", "show", "shows", "list", "lists", "rows", "row",
    "range", "period", "dates", "only", "totals",
    "tell", "tells", "telling", "about", "overview", "summary", "information",
    "info", "details", "detail",
    "payment", "payments", "type", "types", "bank", "banks", "use", "using",
    "usually", "often", "always", "habit", "methods", "method", "pays", "paid", "pay",
    "assigned", "person", "group", "pending", "approved", "approval",
    "under", "below", "max", "maximum", "entry", "entered", "recorded",
    "cash", "cheque", "check", "bkash", "nagad", "card", "transfer",
    "city", "brac", "ebl", "dbbl", "ibbl", "retail", "wholesale",
    "corporate", "government", "distributor", "dhaka", "chattogram",
    "chittagong", "sylhet", "khulna", "collection's", "total", "totals",
    "outstanding", "balance", "dues", "owing", "owe", "amount", "status",
    "within", "terms", "good", "current",
  ]);
  const words = work
    .split(/\s+/)
    .map((w) => w.replace(/[^\w.'&-]/g, ""))
    .filter((w) => w && !metrics.has(w.toLowerCase()) && !/^\d+$/.test(w) && w.length >= 2);

  if (words.length >= 1) {
    const joined = words.slice(0, 5).join(" ");
    if (joined.length >= 3) return joined;
  }

  return null;
}
