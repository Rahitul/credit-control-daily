export type IntentId =
  // A — company totals
  | "outstanding_total"
  | "collected_total"
  | "sales_total"
  | "overdue_total"
  | "within_vs_overdue"
  | "collection_rate"
  | "avg_terms"
  | "company_sales_range"
  | "company_payments_range"
  // B — per-customer profile
  | "customer_profile"
  | "customer_outstanding"
  | "customer_sales_total"
  | "customer_collected"
  | "customer_status"
  | "customer_overdue_detail"
  | "customer_terms"
  | "customer_contact"
  | "customer_category_branch"
  | "customer_oldest_overdue"
  | "customer_search"
  | "customer_payment_types"
  | "customer_banks"
  // C — per-customer + date
  | "customer_sales_range"
  | "customer_payments_range"
  // D — rankings
  | "top_customers"
  | "largest_sale"
  | "largest_payment"
  | "newest_sales"
  | "newest_payments"
  // E — breakdowns
  | "breakdown_credit"
  | "breakdown_payment"
  | "breakdown_sales_entry"
  // F — counts
  | "count_customers"
  | "count_overdue"
  | "count_within"
  | "count_pending"
  | "count_sales_range"
  | "count_payments_range"
  // G — lookups
  | "sale_lookup"
  | "payment_lookup"
  | "payments_for_sale"
  | "next_sale_ref"
  | "sale_paid_status"
  // H — lists / alerts
  | "list_overdue"
  | "list_within"
  | "list_overdue_min_days"
  | "overdue_exposure"
  | "list_customers_filtered"
  | "list_pending_customers"
  | "list_payments_filtered"
  | "list_sales_filtered"
  // I — meta
  | "help_credit_limit"
  | "help_overdue_calc"
  | "help_payment_types"
  | "help_sale_ref"
  | "help_pending"
  | "help"
  | "greeting";

export type IntentDef = {
  id: IntentId;
  /** Higher wins when multiple match */
  priority: number;
  /** Lowercase keywords — any match contributes score */
  keywords: string[];
  /** Example chips for UI / help */
  examples: string[];
  family: string;
};

export const INTENTS: IntentDef[] = [
  // ——— A totals ———
  {
    id: "outstanding_total",
    priority: 50,
    keywords: ["total outstanding", "outstanding total", "outstanding amount", "how much outstanding", "total due", "how much is outstanding", "what is outstanding", "outstanding"],
    examples: ["What is outstanding total amount?"],
    family: "Company totals",
  },
  {
    id: "collected_total",
    priority: 50,
    keywords: ["total collected", "how much collected", "total collection", "how much have we collected", "collected total", "total received", "collection total"],
    examples: ["How much have we collected in total?"],
    family: "Company totals",
  },
  {
    id: "sales_total",
    priority: 50,
    keywords: ["total sales", "total sale", "company sales", "how much sales", "how much did we sell", "sales total", "sum of sales"],
    examples: ["What are total company sales?"],
    family: "Company totals",
  },
  {
    id: "overdue_total",
    priority: 55,
    keywords: ["total overdue", "overdue total", "overdue amount", "total past due", "how much overdue", "past-due exposure", "past due amount"],
    examples: ["What is the total overdue amount?"],
    family: "Company totals",
  },
  {
    id: "within_vs_overdue",
    priority: 45,
    keywords: ["within vs overdue", "within versus overdue", "how many within", "within terms total"],
    examples: ["How many within vs overdue?"],
    family: "Company totals",
  },
  {
    id: "collection_rate",
    priority: 55,
    keywords: ["collection rate", "percent collected", "percentage collected", "how much percent", "collection percentage"],
    examples: ["What is our collection rate?"],
    family: "Company totals",
  },
  {
    id: "avg_terms",
    priority: 50,
    keywords: ["average payment term", "average terms", "avg payment term", "average credit limit", "avg terms"],
    examples: ["What is the average payment term?"],
    family: "Company totals",
  },
  {
    id: "company_sales_range",
    priority: 60,
    keywords: ["sales in", "sales during", "sales this", "sales last", "sale in", "how much sales", "total sales in", "sales on", "all sales", "show sales", "give me sales", "list sales", "sales from", "sales 1", "sales range", "sales by", "sales entered", "sales over", "sales under"],
    examples: [
      "What were total sales in August?",
      "Sales this month?",
      "Give me all sales 1 Sep to 30 Sep (show 1 Sep rows, total for range)",
      "Show sales from 1 Sep to 30 Sep",
      "Sales by Rezaul this month",
      "Sales over ৳50000 last month",
      "Sales entered by Rahim 1 Sep to 30 Sep",
    ],
    family: "Company totals",
  },
  {
    id: "company_payments_range",
    priority: 60,
    keywords: ["collected in", "collected this", "collected last", "payments in", "payments this", "payments last", "how much did we collect", "collection in", "received in", "all collection", "all collections", "show collection", "show collections", "give me collection", "give me collections", "collection from", "collections from", "collection 1", "collections 1", "payments by", "payments over", "payments under", "cash payments", "bkash payments", "nagad payments", "bank transfer payments", "collections from city bank", "collections from brac", "how much from city bank", "how much from brac"],
    examples: [
      "How much did we collect this month?",
      "Give me all collection 1 Sep to 30 Sep (show 1 Sep rows, total for range)",
      "Show collections from 1 Sep to 30 Sep",
      "Cash payments this month",
      "bKash payments last week",
      "Payments by bKash this month",
      "Collections from City Bank last week",
      "How much from BRAC Bank this month?",
      "Payments over ৳50000 in September",
      "Payments assigned to Karim this week",
    ],
    family: "Company totals",
  },

  // ——— B profile ———
  {
    id: "customer_contact",
    priority: 70,
    keywords: ["contact person", "phone number", "contact number", "phone of", "address of", "contact info", "contact details", "what is the address", "what's the address"],
    examples: ["What is Rahman's contact person and phone?"],
    family: "Customer",
  },
  {
    id: "customer_terms",
    priority: 65,
    keywords: ["payment term", "credit limit", "terms of", "how many days term", "day term", "credit days"],
    examples: ["What is XYZ's payment term?"],
    family: "Customer",
  },
  {
    id: "customer_category_branch",
    priority: 65,
    keywords: ["category of", "group of", "branch of", "which category", "which branch", "which group", "customer category", "customer branch"],
    examples: ["Which category is XYZ Traders?"],
    family: "Customer",
  },
  {
    id: "customer_oldest_overdue",
    priority: 68,
    keywords: ["oldest unpaid", "oldest overdue", "oldest past due", "when was oldest"],
    examples: ["When is XYZ's oldest unpaid sale?"],
    family: "Customer",
  },
  {
    id: "customer_overdue_detail",
    priority: 66,
    keywords: ["days overdue", "how many days overdue", "how late", "days past due", "overdue by", "how many days late"],
    examples: ["How many days overdue is XYZ?"],
    family: "Customer",
  },
  {
    id: "customer_status",
    priority: 62,
    keywords: ["is overdue", "within terms", "overdue or within", "status of", "is the customer overdue", "customer status", "is xyz overdue", "is it overdue"],
    examples: ["Is XYZ overdue or within terms?"],
    family: "Customer",
  },
  {
    id: "customer_outstanding",
    priority: 60,
    keywords: ["outstanding of", "outstanding for", "balance of", "balance for", "how much does", "how much owes", "owed by", "pending amount of", "dues of", "dues for"],
    examples: ["What is Rahman Trading's outstanding?"],
    family: "Customer",
  },
  {
    id: "customer_collected",
    priority: 60,
    keywords: ["how much has", "how much did", "paid so far", "total paid", "collected from", "payments from", "how much paid", "total collection of", "collection of"],
    examples: [
      "How much has XYZ paid so far?",
      "Global Tech Ltd collection",
      "Rahman Trading total collection",
      "Global Tech Ltd collected",
    ],
    family: "Customer",
  },
  {
    id: "customer_sales_total",
    priority: 60,
    keywords: ["total sale of", "total sales of", "sales of", "sale of", "how much sale", "how much sales", "lifetime sales", "total purchase"],
    examples: ["What is the total sale of Rahman Trading?"],
    family: "Customer",
  },
  {
    id: "customer_search",
    priority: 40,
    keywords: ["search customer", "find customer", "customers matching", "customers like", "who is"],
    examples: ["Find customers matching Acme"],
    family: "Customer",
  },
  {
    id: "customer_profile",
    priority: 45,
    keywords: ["customer profile", "profile of", "about customer", "details of", "info on", "information about", "tell me about", "about company", "company profile", "summary of", "overview of", "tell me about company"],
    examples: [
      "Show profile of XYZ Traders",
      "Tell me about ABC company",
      "Tell me about ABC company from 1 Sep to 30 Sep about the collection",
      "Tell me about Rahman Trading from 1 Sep to 30 Sep about sales",
    ],
    family: "Customer",
  },
  {
    id: "customer_payment_types",
    priority: 80,
    keywords: ["payment type", "payment types", "which payment", "how does", "how do they pay", "usually pay", "payment method", "pay by", "pays with", "which type of payment", "how was paid", "how has paid"],
    examples: [
      "Which payment type does ABC use?",
      "How does Rahman Trading usually pay?",
      "Which payment types has XYZ used?",
    ],
    family: "Customer",
  },
  {
    id: "customer_banks",
    priority: 82,
    keywords: ["which bank", "what bank", "bank does", "bank they", "bank type", "which bank type", "use which bank", "what is the bank", "bank of"],
    examples: [
      "Which bank does ABC company use?",
      "What bank does Rahman Trading use?",
      "Which bank type has XYZ used?",
    ],
    family: "Customer",
  },

  // ——— C customer + date ———
  {
    id: "customer_sales_range",
    priority: 85,
    keywords: ["what was the sale", "what sales", "sales for", "sale for", "sales on", "sale on", "bought on", "purchased on", "sales in", "sale in", "sales last", "sale last", "sales this", "what did", "what was sold"],
    examples: [
      "ABC customer on 19 July — what was the sale?",
      "What sales did XYZ have last month?",
      "What sales did ABC company have from 1 Sep to 30 Sep?",
    ],
    family: "Customer + date",
  },
  {
    id: "customer_payments_range",
    priority: 85,
    keywords: ["payments on", "payment on", "paid on", "collected from on", "payments in", "payments last", "payments this", "payment from", "received from"],
    examples: [
      "Which payments did XYZ make this week?",
      "What did ABC company pay from 1 Sep to 30 Sep?",
      "Show Rahman Trading payments this month",
    ],
    family: "Customer + date",
  },

  // ——— D rankings ———
  {
    id: "largest_sale",
    priority: 75,
    keywords: ["largest sale", "biggest sale", "highest sale", "biggest single sale", "max sale", "maximum sale"],
    examples: ["What is the largest single sale ever?"],
    family: "Rankings",
  },
  {
    id: "largest_payment",
    priority: 75,
    keywords: ["largest payment", "biggest payment", "highest payment", "max payment"],
    examples: ["What is the largest payment recorded?"],
    family: "Rankings",
  },
  {
    id: "newest_sales",
    priority: 72,
    keywords: ["newest sales", "latest sales", "recent sales", "last sales", "last few sales"],
    examples: ["Show 5 newest sales"],
    family: "Rankings",
  },
  {
    id: "newest_payments",
    priority: 72,
    keywords: ["newest payments", "latest payments", "recent payments", "last payments", "recent entries"],
    examples: ["Show recent payments"],
    family: "Rankings",
  },
  {
    id: "top_customers",
    priority: 70,
    keywords: ["top ", "top-", "biggest customer", "largest customer", "most overdue", "highest outstanding", "best customer", "who has the most", "rank customers", "sort by overdue", "top overdue"],
    examples: [
      "Top 5 customers by overdue",
      "Top 10 by outstanding",
      "Top 5 retail customers by overdue",
      "Top 3 in Dhaka by outstanding",
    ],
    family: "Rankings",
  },

  // ——— E breakdowns ———
  {
    id: "breakdown_payment",
    priority: 78,
    keywords: ["by payment type", "payment type breakdown", "by bank", "bank breakdown", "by bank type", "cash vs", "breakdown by type", "collected by type", "by bank name"],
    examples: [
      "Collected by payment type",
      "Breakdown by bank type",
      "Collections by payment type this month",
      "How much from each bank?",
    ],
    family: "Breakdowns",
  },
  {
    id: "breakdown_sales_entry",
    priority: 76,
    keywords: ["sales by entry", "entered by", "entry by", "who entered", "sales by user"],
    examples: ["Sales by entryBy", "Who entered the most sales?"],
    family: "Breakdowns",
  },
  {
    id: "breakdown_credit",
    priority: 74,
    keywords: ["by category", "category breakdown", "by branch", "branch breakdown", "by group", "group breakdown", "outstanding by", "overdue by", "breakdown by category"],
    examples: [
      "Outstanding by category",
      "Overdue by branch",
      "Outstanding by group",
      "Overdue by category",
    ],
    family: "Breakdowns",
  },

  // ——— F counts ———
  {
    id: "count_pending",
    priority: 68,
    keywords: ["pending approval", "how many pending", "pending customers", "awaiting approval"],
    examples: ["How many customers are pending approval?"],
    family: "Counts",
  },
  {
    id: "count_overdue",
    priority: 64,
    keywords: ["how many overdue", "number of overdue", "overdue customers count", "count overdue"],
    examples: [
      "How many overdue customers?",
      "How many retail customers are overdue?",
      "How many overdue in Dhaka?",
    ],
    family: "Counts",
  },
  {
    id: "count_within",
    priority: 64,
    keywords: ["how many within", "within terms count", "how many are within"],
    examples: [
      "How many within terms?",
      "How many corporate customers are within terms?",
    ],
    family: "Counts",
  },
  {
    id: "count_customers",
    priority: 60,
    keywords: ["how many customers", "total customers", "number of customers", "customer count"],
    examples: ["How many customers do we have?"],
    family: "Counts",
  },
  {
    id: "count_sales_range",
    priority: 72,
    keywords: ["how many sales", "number of sales", "count of sales", "sales count"],
    examples: [
      "How many sales today?",
      "How many sales by Rezaul this month?",
      "How many sales over ৳50000 last month?",
    ],
    family: "Counts",
  },
  {
    id: "count_payments_range",
    priority: 72,
    keywords: ["how many payments", "number of payments", "payment count", "count payments"],
    examples: [
      "How many payments this month?",
      "How many bKash payments this week?",
      "How many cash payments in September?",
    ],
    family: "Counts",
  },

  // ——— G lookups ———
  {
    id: "next_sale_ref",
    priority: 90,
    keywords: ["next sale ref", "next reference", "next sale reference", "next sale id"],
    examples: ["What is the next sale reference?"],
    family: "Lookups",
  },
  {
    id: "sale_paid_status",
    priority: 92,
    keywords: ["is sale", "sale paid", "fully paid", "still unpaid", "is fully paid", "sale is paid", "remaining on sale", "paid yet"],
    examples: ["Is SALE-2026-0007 fully paid?"],
    family: "Lookups",
  },
  {
    id: "payments_for_sale",
    priority: 90,
    keywords: ["payments for sale", "payments linked", "payments related to", "against sale", "payment for sale"],
    examples: ["Show payments linked to SALE-2026-0010"],
    family: "Lookups",
  },
  {
    id: "sale_lookup",
    priority: 90,
    keywords: ["find sale", "sale ", "lookup sale", "show sale", "sale reference", "find SALE"],
    examples: ["Find SALE-2026-0042"],
    family: "Lookups",
  },
  {
    id: "payment_lookup",
    priority: 88,
    keywords: ["bill no", "bill number", "find payment", "payment for bill", "billno", "lookup bill"],
    examples: ["Find payment for bill INV-1001"],
    family: "Lookups",
  },
  // ——— H lists / alerts ———
  {
    id: "list_overdue_min_days",
    priority: 70,
    keywords: ["more than", "over ", "greater than", "past "],
    examples: [
      "Who is overdue by more than 30 days?",
      "Dhaka customers overdue more than 30 days",
      "Retail overdue over 15 days",
    ],
    family: "Alerts",
  },
  {
    id: "list_overdue",
    priority: 58,
    keywords: ["list overdue", "overdue customers", "who is overdue", "show overdue", "all overdue", "which customers are overdue"],
    examples: [
      "List all overdue customers",
      "List retail customers who are overdue",
      "Show overdue customers in Dhaka",
      "Who is overdue with outstanding over ৳100000?",
    ],
    family: "Alerts",
  },
  {
    id: "list_within",
    priority: 58,
    keywords: ["list within", "within customers", "who is within", "show within", "all within", "within terms list"],
    examples: [
      "List customers within terms",
      "List corporate customers within terms",
      "Show within customers in Chattogram",
    ],
    family: "Alerts",
  },
  {
    id: "list_customers_filtered",
    priority: 55,
    keywords: ["list customers", "show customers", "all customers", "customers in", "customers with", "customers by", "which customers", "customer list"],
    examples: [
      "List retail customers in Dhaka",
      "Show corporate customers",
      "List customers in group ABC Group",
      "Show all wholesale customers",
    ],
    family: "Alerts",
  },
  {
    id: "list_pending_customers",
    priority: 72,
    keywords: ["list pending", "show pending", "pending customers", "pending approval list", "awaiting approval list", "customers awaiting"],
    examples: [
      "Show pending customers",
      "List customers awaiting approval",
      "Who is pending approval?",
    ],
    family: "Alerts",
  },
  {
    id: "list_payments_filtered",
    priority: 68,
    keywords: ["list payments", "show payments", "payment list", "payments by cash", "payments by bkash", "payments by cheque", "payments by card", "payments assigned"],
    examples: [
      "List cash payments this month",
      "Show bKash payments last week",
      "List payments assigned to Karim",
      "Show payments from City Bank 1 Sep to 30 Sep",
    ],
    family: "Alerts",
  },
  {
    id: "list_sales_filtered",
    priority: 68,
    keywords: ["list sales", "show sales list", "sales entered by", "sales by entry", "sales of amount"],
    examples: [
      "List sales entered by Rezaul this month",
      "Show sales over ৳100000 last month",
      "List sales by Rahim 1 Sep to 30 Sep",
    ],
    family: "Alerts",
  },
  {
    id: "overdue_exposure",
    priority: 62,
    keywords: ["past-due exposure", "past due exposure", "overdue exposure", "total exposure"],
    examples: ["What is our past-due exposure?"],
    family: "Alerts",
  },

  // ——— I meta ———
  {
    id: "help_credit_limit",
    priority: 95,
    keywords: ["what does credit limit mean", "what is credit limit", "credit limit meaning", "payment term meaning"],
    examples: ["What does credit limit mean here?"],
    family: "Help",
  },
  {
    id: "help_overdue_calc",
    priority: 95,
    keywords: ["how is overdue", "how overdue is calculated", "overdue calculation", "how do you calculate overdue", "fifo"],
    examples: ["How is overdue calculated?"],
    family: "Help",
  },
  {
    id: "help_payment_types",
    priority: 95,
    keywords: ["allowed payment types", "payment types list", "what payment types", "bank types list", "allowed bank"],
    examples: ["What are the allowed payment types?"],
    family: "Help",
  },
  {
    id: "help_sale_ref",
    priority: 95,
    keywords: ["sale ref format", "reference format", "sale id format", "sale reference format"],
    examples: ["What sale ref format do we use?"],
    family: "Help",
  },
  {
    id: "help_pending",
    priority: 95,
    keywords: ["pending customer", "can i add payment for pending", "pending approval rules"],
    examples: ["Can I add a payment for a pending customer?"],
    family: "Help",
  },
  {
    id: "help",
    priority: 10,
    keywords: ["help", "what can you", "capabilities", "examples", "how to use", "commands"],
    examples: ["What can you ask me?"],
    family: "Help",
  },
  {
    id: "greeting",
    priority: 5,
    keywords: ["hi", "hello", "hey", "salam", "assalam"],
    examples: ["Hi"],
    family: "Help",
  },
];

/** Curated chips for the widget welcome screen (first 8 shown as chips) */
export const WELCOME_EXAMPLES: string[] = [
  "Tell me about ABC company",
  "Tell me about ABC company from 1 Sep to 30 Sep about the collection",
  "Which payment type does ABC use?",
  "Which bank does ABC company use?",
  "What is outstanding total amount?",
  "List all overdue customers",
  "Give me all collection 1 Sep to 30 Sep (show 1 Sep, total for range)",
  "Top 5 customers by overdue",
  "How many overdue customers?",
  "What is the total overdue amount?",
  "Rahman Trading on 19 July — what was the sale?",
  "How much did we collect this month?",
  "Give me all sales 1 Sep to 30 Sep (show 1 Sep, total for range)",
  "Show collections from 1 Sep to 30 Sep",
  "Collected by payment type",
  "Find SALE-2026-0001",
  "How is overdue calculated?",
  "List retail customers in Dhaka",
  "Show pending customers",
  "Cash payments this month",
  "Sales by Rezaul this month",
];

export type QuestionItem = {
  family: string;
  example: string;
  intent: IntentId;
};

/** Full catalog for the chat “all questions” browser (same set help prints). */
export function allQuestions(): QuestionItem[] {
  const seen = new Set<string>();
  const items: QuestionItem[] = [];
  const push = (family: string, example: string, intent: IntentId) => {
    const key = example.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ family, example, intent });
  };
  for (const ex of WELCOME_EXAMPLES) push("Featured", ex, "help");
  for (const intent of INTENTS) {
    if (intent.id === "help" || intent.id === "greeting") continue;
    for (const ex of intent.examples) push(intent.family, ex, intent.id);
  }
  return items;
}
