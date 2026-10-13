# Credit Assistant — Chatbot Documentation

Rule-based Q&A chatbot for the Credit Control Daily app. No LLM, no external API key — answers are computed live from MongoDB.

---

## 1. Overview

| Item | Detail |
|------|--------|
| Name | Credit Assistant |
| Type | Rule-based intent matcher (not generative AI) |
| Data | Live MongoDB (`creditcontroldaily`) |
| Audience | **admin** and **accounts** roles only |
| UI | Floating bubble, bottom-right (`ChatWidget`) |
| Server action | `askAssistant` in `app/actions/chat.ts` |
| Max input | 500 characters |
| List cap | 12 rows per list answer (`LIST_CAP`) |
| Currency | ৳ BDT via `formatBDT` |

### Design decisions

- **Rule-based, not LLM** — data stays in-house; no API key; deterministic answers.
- **Floating bubble** placement (not a full page).
- **All roles** (UI mounts unconditionally in `AppShell`; server-side `requireRole(...ENTRY_ROLES, "admin")`).
- Full intent catalog with examples, including date-scoped questions like:
  - *“How much have we collected in previous month?”*
  - *“Give me all collection 1 Sep to 30 Sep (show 1 Sep rows, total for range)”*
  - *“ABC customer on 19 July — what was the sale?”*

---

## 2. File map

| Path | Role |
|------|------|
| `lib/chat/intents.ts` | Intent registry (`IntentId`, `INTENTS`, `WELCOME_EXAMPLES`, `allQuestions()`) |
| `lib/chat/dates.ts` | Date/range parser (`parseDateRange`, `DateRange`) |
| `lib/chat/parse.ts` | Slot extraction (`parseQuery` → `ParsedQuery`) |
| `lib/chat/answer.ts` | Intent scoring (`matchIntent`) + all answer handlers |
| `app/actions/chat.ts` | Server action `askAssistant` + `ChatActionResult` |
| `components/ChatWidget.tsx` | Client UI (bubbles, chips, clear, input, all-questions browser + search) |
| `components/AppShell.tsx` | Mounts widget when `user.roles` includes admin or accounts |

```
User message
   │
   ▼
ChatWidget (client)
   │  FormData { message }
   ▼
askAssistant (server action)
   │  requireRole("admin","accounts")
   ▼
parseQuery  ──►  ParsedQuery
   │               ├─ dateRange (dates.ts)
   │               ├─ customerHint
   │               ├─ saleRef / billNo
   │               └─ topN, minDays, filters…
   ▼
answerQuery
   │  matchIntent(q) → IntentId
   │  getCustomerCredits({ viewer })  ← approval gating
   │  handler branch → Markdown-ish text (**bold**)
   ▼
ChatActionResult { ok, answer } → bubble
```

---

## 3. Access control

### UI

`AppShell.tsx`:

```ts
const canChat = user.roles.includes("admin") || user.roles.includes("accounts");
{canChat ? <ChatWidget /> : null}
```

Do **not** import `hasRole` from `lib/auth` into client components (pulls `next/headers` into the browser bundle).

### Server

`app/actions/chat.ts`:

```ts
const user = await requireRole("admin", "accounts");
```

Mutations and answers re-check roles inside the action — never trust the form alone.

### Data visibility

Always call:

```ts
getCustomerCredits({ viewer: { id: user.id, roles: user.roles } })
```

Pending customers are visible only to **admin** or the **creator**. Omitting `viewer` returns approved-only (safe default).

---

## 4. Pipeline details

### 4.1 Date parsing — `lib/chat/dates.ts`

`parseDateRange(text, now?)` returns `{ from, to, label } | null`.

**Order of checks:**

1. **Explicit range** (highest priority)  
   `1 sep to 30 sep`, `from 1/9 until 30/9`, `2026-09-01 – 2026-09-30`  
   - Connectors: `to | through | thru | till | until | – | — | -`  
   - Both ends share the **same year** when no year is in the text (avoids `1 sep to 30 sep` → 2025–2026).  
   - Ends are sorted so `from <= to`.  
   - Day/month tokens without year: `1/9`, `30.09`.

2. **Relative day words**  
   `today`, `tomorrow`/`tmr`, `yesterday`

3. **Relative periods**  
   - `last week` / `previous week` (Mon–Sun of previous week)  
   - `this week` / `current week`  
   - `last month` / `previous month` (full previous calendar month)  
   - `this month` / `current month`  
   - `ytd` / `this year` / `current year`  
   - `last year`  
   - `last N days`

4. **Absolute formats**  
   - ISO: `2026-07-19`  
   - Slash/dot day-first: `19/07/2026`, `19.07.26`  
   - Day month: `19 july`, `19 july 2026`  
   - Month day: `july 19`, `july 19 2026`  
   - If no year and date is in the future → fall back to **previous year** (single-date only).

5. **Month name anywhere**  
   `sales in august`, `in july`, `august` → full calendar month.  
   Scans **all** words (not just the first), so “sales in august” works.

**Labels:** `en-GB` style — `01 Sept 2026 – 30 Sept 2026`, or single day `19 Jul 2026`.

**Multi-day detection:** `isMultiDayRange` — `from` and `to` are not the same calendar day.

### 4.2 Slot extraction — `lib/chat/parse.ts`

`parseQuery(rawInput)` builds:

| Field | How it is found |
|-------|-----------------|
| `dateRange` | `parseDateRange(raw)` |
| `saleRef` | `SALE-\d{4}-\d{3,6}` |
| `billNo` | `bill no X`, `INV-…`, `BL-…`, `BILL-…` |
| `topN` | `top N`, `first N`, `show N`, `give me N`; default 5 if biggest/largest/most/highest/top |
| `minDays` | `more than N days`, `over N days`, `N+ days overdue` |
| `minAmount` | `over 100000`, `৳100000`, `over 50k` / `50 lakh` (bare numbers need 3+ digits so “over 30 days” stays `minDays`) |
| `maxAmount` | `under 50000`, `below ৳100k`, `max 20000` |
| `category` | retail, wholesale, corporate, government, distributor, other |
| `branch` | dhaka, chattogram/chittagong, sylhet, khulna |
| `group` | `in group X`, `group X` (case preserved from raw) |
| `paymentType` | cash, cheque/check, bkash, nagad, bank transfer, card |
| `bankType` | city bank, brac bank, ebl, dbbl, ibbl (also `$or` bankName in queries) |
| `entryBy` | `by Name`, `entered by Name`, `entry by Name` (case preserved; trailing period words stripped; bare “by” skipped for payment/bank/branch vocab) |
| `assignedPerson` | `assigned to Name` (case preserved; trailing `this week/month` stripped) |
| `approval` | `pending` + customer/approval/awaiting; `approved` + customer/only |
| `status` | overdue / within keywords |
| `descriptionHint` | after `description …` or in quotes |
| `customerHint` | see below |

#### Customer hint rules (critical)

Period words must **never** become a customer name. Assigned/entry-by person names must **not** become a customer.

1. Always strip relative phrases:  
   `previous month`, `last month`, `this week`, `ytd`, `last 7 days`, …
2. Always strip explicit ranges:  
   `1 sep to 30 sep`, `from 1/9 until 30/9`, …
3. Strip ISO / slash / day-month / month-day / month-name fragments.
4. Strip `assigned to X` / `entered by X` phrases (person is not a customer).
5. Drop leading boilerplate:  
   `what`, `how much`, `show me`, `give me`, `list`, `all`, …
6. Prefer capitalized multi-word phrases (`Rahman Trading Co.`) on the date-stripped work string (**even when a dateRange is present**); reject `stopCaps` heads and strip trailing habit words (`use`, `usually`, `pay`, `collection`, … with word boundaries).
7. Fallback: leftover words after removing a large **metrics stop-list**, **preserving original casing** (not lowercased).

**Verified examples:**

| Question | dateRange | customerHint |
|----------|-----------|--------------|
| How much have we collected in previous month? | last month | `null` |
| Give me all collection 1 Sep to 30 Sep | 01–30 Sep 2026 | `null` |
| What is outstanding for Rahman Trading? | null | `Rahman Trading` |
| ABC customer on 19 July — what was the sale? | 19 Jul 2026 | `ABC` |
| Tell me about ABC company | null | `ABC company` |
| Tell me about Rahman Trading | null | `Rahman Trading` |
| Which payment type does ABC use? | null | `ABC` |
| Which bank does ABC company use? | null | `ABC company` |
| tell me about ABC company from 1 sep to 30 sep about the collection | 01–30 Sep 2026 | `ABC company` |
| How does Rahman Trading usually pay? | null | `Rahman Trading` |

### 4.3 Intent matching — `matchIntent` in `answer.ts`

Scored map; highest score wins; default `help`.

**Base score** for every keyword hit:

```
score += keyword.length + intent.priority
```

**Structural boosts (examples):**

| Condition | Intent | Boost |
|-----------|--------|-------:|
| Has `saleRef` + paid/unpaid wording | `sale_paid_status` | +300 |
| Has `saleRef` + payments | `payments_for_sale` | +280 |
| Has `saleRef` alone | `sale_lookup` | +260 |
| Has `billNo` | `payment_lookup` | +280 |
| Date + customer + sale words (not company-wide) | `customer_sales_range` | +300 |
| Date + customer + payment words (not company-wide) | `customer_payments_range` | +300 |
| Date + customer + “tell me about / about the collection” | `customer_profile` | +360 |
| Date + “how many sales” | `count_sales_range` | +250 |
| Date + “how many … payments” | `count_payments_range` | +300 |
| Date + company sales phrasing | `company_sales_range` | +200 / +140 |
| Date + company collection phrasing (not payment-list) | `company_payments_range` | +220 / +180 |
| Multi-day range + sales (not payment-list) | `company_sales_range` | +80 |
| Multi-day range + collections (not payment-list) | `company_payments_range` | +80 |
| No date + “total collected” | `collected_total` | +200 |
| `minDays` parsed | `list_overdue_min_days` | +200 |
| Customer hint + contact/phone/address | `customer_contact` | +100 |
| Customer hint + “tell me about / about company” | `customer_profile` | +320 |
| Customer hint + payment type / how does … pay | `customer_payment_types` | +340 |
| Customer hint + which/what bank | `customer_banks` | +350 |
| `approval=pending` + list/show/who | `list_pending_customers` | +280 |
| list/show + category/branch/group (not overdue/within) | `list_customers_filtered` | +260 |
| paymentType/bankType/assigned + list/show/all | `list_payments_filtered` | +300 |
| paymentType/bankType/assigned + how many | `count_payments_range` | +350 |
| paymentType/bankType/assigned + how much/total | `company_payments_range` | +220 |
| entryBy + sales (not breakdown phrasing) | `list_sales_filtered` | +200 |

When payment filters + list/show are present, company date-range boosts are **suppressed** (`preferPaymentList`) so list answers win over company totals.

**Company-level detection** (prevents “previous”/date leftover becoming a customer):

```ts
hasCompanyPronoun = we|our|us|company|business|give me|show me|how much have we|how much did we|total company
companyLevel = hasCompanyPronoun | how much|give me|show | (no customerHint AND total|all|every)
looksCompanyCollection = collections?|collected|collection  AND  companyLevel|all|give me|show|total
looksCompanySales      = sales?                              AND  companyLevel|all|give me|show|total
```

Customer+date boosts are **skipped** when `hasCompanyPronoun` (we/our/company) matches.  
Bare `total` alone is **not** company-level when a `customerHint` exists — so *“Global Tech Ltd total collection”* stays on `customer_collected` (+380, company totals −300).

### 4.4 Customer resolution — `findCustomers`

Against visible credit rows:

| Match | Score |
|-------|------:|
| Exact name | 100 |
| Name contains hint | 80 |
| Hint contains name | 70 |
| Token hits (parts length ≥ 3) | 40 + 10×hits |

Keep score ≥ 40; top 5 candidates.  
Exact = best; if no exact and **exactly one** candidate → use it.  
Multiple → “several customers matching …”. None → “Customer **X** does not exist in the database.”

**Safety net:** if intent is `customer_*_range`, no customer, but `dateRange` exists → answer **company-wide** for that range (not an error).

### 4.5 Answer handlers — `answerQuery`

Always loads credit rows first, then branches by intent.

| Section | Intents |
|---------|---------|
| Meta | `help`, `greeting`, `help_credit_limit`, `help_overdue_calc`, `help_payment_types`, `help_sale_ref`, `help_pending` |
| Lookups | `next_sale_ref`, `sale_lookup`, `sale_paid_status`, `payments_for_sale`, `payment_lookup`, `description_search` |
| Company totals | `outstanding_total`, `collected_total`, `sales_total`, `overdue_total`/`overdue_exposure`, `within_vs_overdue`, `collection_rate`, `avg_terms`, counts |
| Date ranges | `company_sales_range`, `company_payments_range`, `count_sales_range`, `count_payments_range` — honor `entryBy`, `paymentType`, `bankType`, `assignedPerson`, `branch`, `min/maxAmount`, category/group scope |
| Filtered lists | `list_sales_filtered`, `list_payments_filtered` (all-time or date-scoped; same filter slots) |
| Customer + date | `customer_sales_range`, `customer_payments_range` (+ company fallback) |
| Customer profile | contact, terms, category, oldest overdue, days overdue, status, outstanding, collected, sales total, search, profile (with optional date period lines for sales/collection/both) |
| Customer habits | `customer_payment_types` (grouped Payment.paymentType counts/totals), `customer_banks` (bankType/bankName) |
| Lists | `list_overdue`, `list_overdue_min_days`, `list_within`, `list_customers_filtered`, `list_pending_customers` — category, branch, group, approval, minDays, min/max outstanding |
| Rankings | `top_customers` (+ category/branch/group/status filters), `largest_sale`, `largest_payment`, `newest_sales`, `newest_payments` |
| Breakdowns | `breakdown_payment` (date/amount/bank filters), `breakdown_sales_entry` (date/amount/entryBy), `breakdown_credit` (category/branch/group pool) |
| Fallback | customer profile summary, or “I didn’t quite get that” |

**Domain reminders baked into answers:**

- Credit limit = **days to pay**, not money.
- Overdue = unpaid remaining past `saleDate + creditLimitDays`.
- Payments allocate **FIFO** (`allocatePayments` / `lib/credit.ts`).
- Sale refs: `SALE-YYYY-NNNN`.
- Pending customers: sales/payments reject non-approved; only admin/creator sees pending.

---

## 5. Date-range behavior (collections & sales)

**Requirement:** for a multi-day range (e.g. *1 Sep to 30 Sep*), show **only the first day’s rows** but **total for the whole range**.

### Implementation

| Helper | Purpose |
|--------|---------|
| `firstDayOnly(range)` | Shrink range to first calendar day |
| `totalSalesInRange(range, filters?)` | Mongo **aggregate** sum + count over full range + filters |
| `totalPaymentsInRange(range, filters?)` | Mongo **aggregate** sum + count over full range + filters |
| `rangeTotalHeader(kind, range, total, count, unit)` | Header + “Showing **dd Mmm yyyy** only” note |
| `loadSalesInRange` / `loadPaymentsInRange` | Load list rows (first day only when multi-day; cap 200 for display) |
| `filtersFromQuery` / `customerFilters` / `withCategoryScope` | Build `RangeFilters` from parsed slots (+ category/group → customerIds) |
| `filterCreditRows` | Apply category/branch/group/approval/status/minDays/min-maxAmount to credit rows |
| `filterBits` / `filtersLine` | Human-readable “Filters: …” line on range/list answers |

**Why aggregate for totals:** display load is capped; totals must stay correct past 200 rows.

### Response shape (multi-day)

```
**Collected 01 Sept 2026 – 30 Sept 2026: ৳X** (N payment(s) in range)
Showing **01 Sept 2026** only · total above is for the full range
• 01 Sep 2026 · ৳… · Cash · Customer Name
…
```

Same pattern for **Sales**. Single-day ranges omit the “Showing … only” line.

Applied to:

- `company_sales_range` / `company_payments_range`
- Company fallback when customer+date intent has no real customer
- `customer_sales_range` / `customer_payments_range` (header adds “full range · showing … only”)

Counts (`count_sales_range` / `count_payments_range`) always report full-range count + total.

---

## 6. Complete question catalog

### 6.1 Welcome chips (`WELCOME_EXAMPLES`)

Shown as clickable chips (first **8** in the widget; full list in `help`):

1. Tell me about ABC company
2. Tell me about ABC company from 1 Sep to 30 Sep about the collection
3. Which payment type does ABC use?
4. Which bank does ABC company use?
5. What is outstanding total amount?
6. List all overdue customers
7. Give me all collection 1 Sep to 30 Sep (show 1 Sep, total for range)
8. Top 5 customers by overdue
9. How many overdue customers?
10. What is the total overdue amount?
11. Rahman Trading on 19 July — what was the sale?
12. How much did we collect this month?
13. Give me all sales 1 Sep to 30 Sep (show 1 Sep, total for range)
14. Show collections from 1 Sep to 30 Sep
15. Collected by payment type
16. Find SALE-2026-0001
17. How is overdue calculated?
18. List retail customers in Dhaka
19. Show pending customers
20. Cash payments this month
21. Sales by Rezaul this month

### 6.2 All intents by family

#### A — Company totals

| Intent | Example questions | Keywords (summary) |
|--------|-------------------|--------------------|
| `outstanding_total` | What is outstanding total amount? | total outstanding, outstanding amount, total due… |
| `collected_total` | How much have we collected in total? | total collected, how much have we collected… |
| `sales_total` | What are total company sales? | total sales, how much did we sell… |
| `overdue_total` | What is the total overdue amount? | total overdue, past due amount… |
| `within_vs_overdue` | How many within vs overdue? | within vs overdue… |
| `collection_rate` | What is our collection rate? | collection rate, percent collected… |
| `avg_terms` | What is the average payment term? | average payment term, avg terms… |
| `company_sales_range` | What were total sales in August? / Sales this month? / **Give me all sales 1 Sep to 30 Sep (show 1 Sep rows, total for range)** / **Show sales from 1 Sep to 30 Sep** / Sales by Rezaul this month / Sales over ৳50000 last month / Sales entered by Rahim 1 Sep to 30 Sep | sales in, sales this, sales last, all sales, show sales, give me sales, sales from, sales by, sales entered, sales over, sales under… |
| `company_payments_range` | How much did we collect this month? / **Give me all collection 1 Sep to 30 Sep (show 1 Sep rows, total for range)** / **Show collections from 1 Sep to 30 Sep** / Cash payments this month / bKash payments last week / Collections from City Bank last week / How much from BRAC Bank this month? / Payments over ৳50000 in September | collected in, how much did we collect, all collection(s), show collection(s), cash payments, bkash payments, collections from city bank, how much from brac… |

#### B — Per-customer profile

| Intent | Example questions |
|--------|-------------------|
| `customer_contact` | What is Rahman's contact person and phone? |
| `customer_terms` | What is XYZ's payment term? |
| `customer_category_branch` | Which category is XYZ Traders? |
| `customer_oldest_overdue` | When is XYZ's oldest unpaid sale? |
| `customer_overdue_detail` | How many days overdue is XYZ? |
| `customer_status` | Is XYZ overdue or within terms? |
| `customer_outstanding` | What is Rahman Trading's outstanding? |
| `customer_collected` | How much has XYZ paid so far? / **Global Tech Ltd collection** / **Rahman Trading total collection** / **Global Tech Ltd collected** (short form: customer hint + collection/collected/payment words → customer, not company total) |
| `customer_sales_total` | What is the total sale of Rahman Trading? |
| `customer_search` | Find customers matching Acme |
| `customer_profile` | Show profile of XYZ Traders / **Tell me about ABC company** / **Tell me about ABC company from 1 Sep to 30 Sep about the collection** / **Tell me about Rahman Trading from 1 Sep to 30 Sep about sales** (period lines + lifetime sales, collection, outstanding, overdue) |
| `customer_payment_types` | Which payment type does ABC use? / How does Rahman Trading usually pay? / Which payment types has XYZ used? |
| `customer_banks` | Which bank does ABC company use? / What bank does Rahman Trading use? / Which bank type has XYZ used? |

#### C — Customer + date

| Intent | Example questions |
|--------|-------------------|
| `customer_sales_range` | ABC customer on 19 July — what was the sale? / What sales did XYZ have last month? |
| `customer_payments_range` | Which payments did XYZ make this week? |

#### D — Rankings

| Intent | Example questions |
|--------|-------------------|
| `largest_sale` | What is the largest single sale ever? |
| `largest_payment` | What is the largest payment recorded? |
| `newest_sales` | Show 5 newest sales |
| `newest_payments` | Show recent payments |
| `top_customers` | Top 5 customers by overdue / Top 10 by outstanding |

Metric for `top_customers`: default overdue; switches on outstanding / sales / collected / days in the question.

#### E — Breakdowns

| Intent | Example questions |
|--------|-------------------|
| `breakdown_payment` | Collected by payment type / Breakdown by bank type / Collections by payment type this month / How much from each bank? |
| `breakdown_sales_entry` | Sales by entryBy / Who entered the most sales? |
| `breakdown_credit` | Outstanding by category / Overdue by branch / by group |

#### F — Counts

| Intent | Example questions |
|--------|-------------------|
| `count_pending` | How many customers are pending approval? |
| `count_overdue` | How many overdue customers? / How many retail customers are overdue? / How many overdue in Dhaka? |
| `count_within` | How many within terms? / How many corporate customers are within terms? |
| `count_customers` | How many customers do we have? |
| `count_sales_range` | How many sales today? / How many sales by Rezaul this month? / How many sales over ৳50000 last month? |
| `count_payments_range` | How many payments this month? / How many bKash payments this week? / How many cash payments in September? |

#### G — Lookups

| Intent | Example questions |
|--------|-------------------|
| `next_sale_ref` | What is the next sale reference? |
| `sale_paid_status` | Is SALE-2026-0007 fully paid? |
| `payments_for_sale` | Show payments linked to SALE-2026-0010 |
| `sale_lookup` | Find SALE-2026-0042 |
| `payment_lookup` | Find payment for bill INV-1001 |
| `description_search` | Show sales matching description solar |

#### H — Lists / alerts

| Intent | Example questions |
|--------|-------------------|
| `list_overdue_min_days` | Who is overdue by more than 30 days? / Dhaka customers overdue more than 30 days / Retail overdue over 15 days |
| `list_overdue` | List all overdue customers / List retail customers who are overdue / Show overdue customers in Dhaka / Who is overdue with outstanding over ৳100000? |
| `list_within` | List customers within terms / List corporate customers within terms / Show within customers in Chattogram |
| `list_customers_filtered` | List retail customers in Dhaka / Show corporate customers / List customers in group ABC Group / Show all wholesale customers |
| `list_pending_customers` | Show pending customers / List customers awaiting approval / Who is pending approval? |
| `list_payments_filtered` | List cash payments this month / Show bKash payments last week / List payments assigned to Karim / Show payments from City Bank 1 Sep to 30 Sep |
| `list_sales_filtered` | List sales entered by Rezaul this month / Show sales over ৳100000 last month / List sales by Rahim 1 Sep to 30 Sep |
| `overdue_exposure` | What is our past-due exposure? |

Filters on customer lists: category, branch, group, approval, status, minDays, min/max outstanding.  
Filters on sale/payment lists: date range, paymentType, bankType, entryBy, assignedPerson, branch, min/maxAmount, category/group (customerIds).

#### I — Meta / help

| Intent | Example questions |
|--------|-------------------|
| `help_credit_limit` | What does credit limit mean here? |
| `help_overdue_calc` | How is overdue calculated? |
| `help_payment_types` | What are the allowed payment types? |
| `help_sale_ref` | What sale ref format do we use? |
| `help_pending` | Can I add a payment for a pending customer? |
| `help` | What can you ask me? / help |
| `greeting` | Hi / hello / hey / salam / assalam |

### 6.3 `help` output

`helpText()` prints:

1. Intro + full `WELCOME_EXAMPLES` list  
2. **Also supported:** grouped by family — **every example** for each intent (**no 6-cap**; full catalog)

The widget’s **All questions** panel uses `allQuestions()` in `lib/chat/intents.ts` (Featured = `WELCOME_EXAMPLES`, then every intent example by family; skips `help`/`greeting`) — same set as `help`, with live search.

---

## 7. UI (`ChatWidget`)

| Feature | Detail |
|---------|--------|
| Placement | `fixed bottom-4 right-4 z-[60]` |
| Open control | Indigo circular Bot (robot) button with **border-running light** (`.chat-fab-ring`, same conic-gradient orbit as theme toggle) |
| Nudge bubble | Colorful gradient “Chat with me…” teaser left of the FAB; auto-hides after **5s** or on open |
| Header | “Credit Assistant” · “Live data · your credit books” |
| All questions | List icon in header **or** “All questions” chip (`ChevronLeft`) on welcome — opens full catalog browser (`allQuestions()` grouped by family, same set as `help`) |
| Search | Search bar in questions view filters examples by text or family (case-insensitive) |
| Question click | Submits example into chat and returns to conversation |
| Back / close | `<` in questions header returns to chat; X closes questions (or panel when in chat) |
| Clear chat | Eraser icon — resets to welcome message; disabled when empty |
| Close | X icon |
| Messages | User right (indigo), bot left (zinc) with Bot/User icons |
| Bold | `**text**` → `<strong>` via `renderBold` |
| Welcome chips | First 8 `WELCOME_EXAMPLES`; hidden after conversation grows (`messages.length > 2`) |
| Input | `maxLength={500}`, `.input-field`, Send button |
| Pending | Spinner + “Calculating…” |
| Errors | Rose banner from `state.error` |
| Theme | `useTheme()` — dark/light surfaces (no hard-coded dark-only) |
| Auto-scroll | `scrollIntoView` on messages/state/open |

Dedupes answers with `lastAnswerRef` so the same reply is not appended twice.

---

## 8. Server action contract

```ts
export type ChatActionResult = {
  ok: boolean;
  answer?: string;
  error?: string;
};

export async function askAssistant(
  _prev: ChatActionResult | undefined,
  formData: FormData
): Promise<ChatActionResult>
```

Validation:

- Empty message → `{ ok: false, error: "Type a question first." }`
- Length > 500 → error
- Any throw → logged + generic “Could not answer that right now.”

Success: `{ ok: true, answer }`.

---

## 9. Date-range question patterns (worked examples)

| User text | Parsed range | List shown | Total |
|-----------|--------------|------------|-------|
| Give me all collection 1 Sep to 30 Sep | 01–30 Sep 2026 | 01 Sep only | Full range aggregate |
| Give me all sales 1 Sep to 30 Sep | 01–30 Sep 2026 | 01 Sep only | Full range aggregate |
| Show collections from 1 Sep to 30 Sep | 01–30 Sep 2026 | 01 Sep only | Full range aggregate |
| collections 1 sep - 30 sep | 01–30 Sep 2026 | 01 Sep only | Full range aggregate |
| 1/9 to 30/9 | 01–30 Sep 2026 | 01 Sep only | Full range aggregate |
| sales from 1 sep to 30 sep 2026 | 01–30 Sep 2026 | 01 Sep only | Full range aggregate |
| How much did we collect this month? | this month → now | n/a (header total) | Full period |
| How much have we collected in previous month? | last month | n/a | Full previous month |
| Rahman Trading on 19 July — what was the sale? | 19 Jul 2026 | that day | — |
| sales in august | august 2026 | first day of Aug if multi-day list style | Full month |

---

## 10. Extending the chatbot

### Add a new question type

1. Add `IntentId` union member in `lib/chat/intents.ts`.
2. Add `INTENTS` entry: `priority`, `keywords` (lowercase substrings), `examples`, `family`.
3. Optionally boost in `matchIntent` (`answer.ts`) for structural cues (date, customer, ref).
4. Add handler branch in `answerQuery`.
5. Optionally add a curated line to `WELCOME_EXAMPLES`.
6. Verify: `npx tsc --noEmit` → `npx eslint lib/chat` → `npm run build`.

### Fix wording only

Edit `keywords` / `examples` on the existing intent — no new intent needed.

### Date phrases

Add relative phrases in `parseDateRange` **before** single-date fallbacks; strip the same phrase in `extractCustomerHint`.

---

## 11. Known pitfalls & fixes (history)

| Bug | Cause | Fix |
|-----|-------|-----|
| “How much have we collected in previous month?” → “No customer found matching **previous**” | `previous` not stripped; customer intent won | Always strip period phrases; stop-list includes `previous`; company boosts for collection questions; company fallback if no customer + date |
| “1 sep to 30 sep” → 2025–2026 | End date future → past-year fallback on one side only | Explicit ranges lock **same year**, `noPastFallback` |
| “sales in august” → null | Month scan only looked at first word | Scan all tokens for month names |
| `customerHint: "collect"` | Action verb not in stop-list | Added collect/show/give/list/all/range… to metrics |
| Totals wrong past 200 rows | Summed `find().limit(200)` | `total*InRange` Mongo aggregates |
| Rotating theme toggle looked like a fan | `transform: rotate` | Animate `@property --theme-toggle-angle` on conic-gradient |
| Client imported `lib/auth` | `next/headers` in bundle | Role check via `user.roles.includes(...)` in AppShell |
| Hint lowercased / kept “use/usually” | Caps path skipped when dateRange; trailing strip lacked `\b` | Caps on date-stripped work always; trailing habit words with word boundaries; fallback preserves case |
| `entryBy: "rezaul this month"` | Extracted from lowercased string; period not stripped | Extract from raw + strip `this week/month/year` etc. |
| “Show bKash payments” → company totals | Company date boosts beat list | `preferPaymentList` suppresses company boosts when payment filters + list/show |
| “How many bKash payments” → company | `\bhow many payments\b` missed “how many bKash payments” | `/\bhow many\b.*\bpayments?\b/` + list/count boosts |
| “Global Tech Ltd collection” → help | No keyword matched short form; hint kept `collected`/`total` | Short customer+collection boost → `customer_collected`; trailing strip for collected/total/payment; companyLevel only on we/our/company or no-hint+total |

---

## 12. Verification checklist

```bash
npx tsc --noEmit
npx eslint lib/chat components/ChatWidget.tsx app/actions/chat.ts
npm run build
```

No automated test suite exists. Spot-check with `parseQuery` / `parseDateRange` (e.g. temporary `tsx` script) for new date or hint rules, then delete the temp script.

Manual smoke:

1. Login admin (`credentials.md`, password `<seeded-password>`).
2. Open floating assistant.
3. Run welcome chips including **1 Sep to 30 Sep** collection/sales.
4. Confirm first-day rows + full-range total.
5. Ask a pending-only customer question as non-creator → should not appear.
6. Clear chat (Eraser) resets to welcome.
7. Open **All questions** → browse grouped examples; search filters live; tapping a question runs it.

---

## 13. Related product rules (affects answers)

- `customer.creditLimitDays` = payment **term in days** (not money limit).
- Overdue = unpaid balance past `saleDate + creditLimitDays`.
- FIFO payment allocation in `lib/credit.ts`.
- Customer `approvalStatus`: pending invisible except admin/creator; sales/payments require approved.
- Dropdown constants live in `lib/types.ts` — never import mongoose models into client components.
- Currency: `formatBDT` / `formatDate` in `lib/format.ts`.

---

## 14. Quick reference — roles & routes

See `credentials.md` for test logins and the full role → route table.

| Role | Chat widget |
|------|-------------|
| admin | Yes |
| accounts | Yes |
| sales | No |
| eid | No |
| esbd | No |
| consumable | No |

---

*Document filename as requested: `chatbotdocumantation.md`*  
*Last matches code state: list-page filter slots wired into chat answers; customer payment-type/bank habits; profile + date period lines; help full catalog; multi-day range first-day list + full-range totals; widget All-questions browser with search; floating Bot icon with circular border-running light and colorful 5s “Chat with me” nudge bubble.*
