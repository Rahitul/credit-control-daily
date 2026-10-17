# AGENTS.md

## Commands

```bash
npm run dev          # Next.js dev server (port 3000)
npm run build        # production build (includes TypeScript check)
npm run lint         # eslint (ignores scripts/, .next/, out/, build/, next-env.d.ts)
npx tsc --noEmit     # typecheck only
npm run seed         # seed MongoDB (users, customers, sales, payments, dropdowns) - additive, no deletes
npm run add-admin    # create/reset admin: rezaul.karim@iomltd.com / <seeded-password>
npm run sync-parties # ensure every pending-bill party has a Customer + customerId link
npm run export-companies # dump distinct company/party names (tsx script)
```

**Verify order:** `npx tsc --noEmit` → `npx eslint <changed files>` → `npm run build`.

- **Phantom TS errors** in `.next/dev/types/validator.ts` (any syntax error: `TS1161 Unterminated regexp`, `TS1128 Declaration or statement expected`, …) occur when dev server killed mid-write. Fix: `Remove-Item -Recurse -Force .next\dev\types` and re-run. Do not edit that file.
- **No test suite, no CI, no pre-commit hooks.** MongoDB is shared/unversioned — treat every DB write as irreversible. Never drop collections. Capture `_id`s of fixture rows and delete in `finally`.
- `npm run seed` does NOT seed `PendingBill` — bills are hand-entered or imported.

## Stack & Environment

- Next.js 16.3.5 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · Mongoose 9
- MongoDB: `mongodb://localhost:27017/creditcontroldaily` (override via `MONGODB_URI`)
- `.env.local`: `MONGODB_URI`, `AUTH_SECRET` (session HMAC; never commit)
- Path alias: `@/*` → repo root (`tsconfig.json`)
- Middleware is `proxy.ts` (root), not `middleware.ts`

## Architecture (Non-Obvious)

### Role-Based App Structure
- One folder per role under `app/`: `admin`, `accounts`, `creditcontrol`, `sales`, `eid`, `eid_juniors`, `esbd`, `consumable`, `branches`
- No shared `/dashboard`; home is `/{role}`
- Each role folder: thin `page.tsx` → shared server component in `components/views/*` + `layout.tsx` calling `requireRole(<role>)` + `AppShell`
- **Non-admin roles share identical pages** (dashboard, customers, sales, payments, dropdowns) via `ENTRY_ROLES` in `lib/nav.ts` — **except `eid_juniors`** (below). Admin is separate.
- **Nav logic lives in `lib/nav.ts`** (`ROLE_HOMES`, `homeForRoles`, `navForRoles`, `REL_NAV`, `ENTRY_ROLES`, `NAV_OVERRIDES`). Change nav there, not in layouts.
- **`eid_juniors` is a read-only sidecar on EID** (clone from it when touching this app):
  - NOT in `ENTRY_ROLES`/`DEPARTMENT_ROLES`/`PENDING_BILL_ROLES` — create/update/delete/import/sale/payment actions all reject it.
  - Sidebar comes from `NAV_OVERRIDES` in `lib/nav.ts` (Pending Bills + Payments + a read-only **My Targets**; no dashboard). Home `/eid_juniors` redirects to pending-bills.
  - Pages: `pending-bills` passes `department="eid"` (rides EID's routing — no bill ever routes to `eid_juniors`); `payments` passes `department="eid"` → `createdByRole` scope, because **Payment has no `departments` field**. On a department-pinned page the `dept` filter param is ignored — scope cannot be overridden.
  - Follow-ups are its only write: `addFollowUp` lists it in `requireRole` explicitly instead of widening `PENDING_BILL_ROLES`. `canWriteAllocatedRow` maps it → `eid` via `ROLE_EQUIV` (`lib/pendingBillsData.ts`), otherwise the department-intersection check fails on every EID bill.
  - Gotcha: `ChatWidget` renders for every role but `app/actions/chat.ts` requires `ENTRY_ROLES` → chatting redirects a pure junior.
- **`creditcontrol` = an Accounts peer, NOT a department.** It is in `ENTRY_ROLES` + `ACCOUNTS_ROLES` + `PAYMENT_APPROVER_ROLES` + the target roles, so it sees every entry/bill, approves payments and sets targets exactly like Accounts; its dashboard is the unscoped `OverviewDashboard` and its sidebar is `NAV_OVERRIDES.creditcontrol` = `REL_NAV` **minus `/distribute`** (Credit Control cannot hand out sales work). `primaryRole` ranks admin > accounts > creditcontrol. Read every "*Accounts/Admin*" in this file as `ACCOUNTS_ROLES` (accounts + creditcontrol + admin).

### Department Dashboards
- `DashboardView` takes `department?: Role | null`; the five department pages pass their role (`department="eid"` etc.). Accounts/Credit Control/Admin keep the unscoped `OverviewDashboard` (`lib/dashboard.ts` — never department-parameterized).
- Scoping inside `getCustomerCredits({ department, branchId })`: sales + bills by routing `departments`, payments by `createdByRole` (no routing field on Payment). Branches app adds `branchId`. **Customer counts stay company-wide** — only money is department-scoped. `department=null` = byte-identical to old behaviour (admin overview, chat, selects).

### Collection Targets
- Week-wise payment-collection targets per user (4 fixed weeks/month: W1 1–7, W2 8–14, W3 15–21, W4 22–end). **Setting is owner-only** — `TARGET_ROLES` = `admin`/`accounts`/`creditcontrol` in `app/actions/collectionTargets.ts`; every other role is rejected there.
- Stored per `{userId, year, month}` with a unique Mongo index; `weeks` = `[w1,w2,w3,w4]`. `saveCollectionTargets` regroups the flat `week-<userId>-<i>` inputs and **deletes** the row when all four weeks are zero (so "no target" stays distinct from a target of 0).
- Progress = approved `Payment.rcvDate` bucketed by week — **not** `createdAt` — attributed by `createdBy`.
- URL `?year=&month=&week=`. `parseWeek()` (`lib/collectionTargets.ts`) returns a **0-based** index, or **`null`** when absent/invalid; `null` = full month, deliberately distinct from week 1 (index 0). `listTargetProgress(year, month, weekIndex?)` **zeroes the other three weeks** when `weekIndex != null`.
- Week-focus UI = `components/WeekFocusSelector.tsx`: soft `router.push`, local state re-synced via the "adjust state during render" pattern (not `useEffect` — trips `react-hooks/set-state-in-effect`). Selected pill needs the trailing-`!` modifier (`.btn-ghost` is unlayered).
- **Personal read-only page in the department apps.** `/{role}/targets` exists for sales/eid/esbd/consumable/branches **and `eid_juniors`**; each passes the session id as `userId`, so `listTargetProgress(year, month, weekIndex?, userId)` scopes the whole read to that one user (`User._id` / `Payment.createdBy` / `CollectionTarget.userId` filters) and `CollectionTargetsView` swaps the editable `CollectionTargetManager` for the read-only `MyTargetCard`. Owners omit `userId` → full editable register. The shared `REL_NAV` `/targets` item lists **every entry role + admin** (department users get the personal page); `eid_juniors` reaches it through a `NAV_OVERRIDES` item.
- **Trap:** while a week is focused the manager still renders all four inputs with the zeroed values, so pressing Save **wipes the other three weeks**. Switch back to "Month view" before saving.

### Access Control
- `lib/auth.ts`: `requireRole`, `hasRole` + `proxy.ts` (root middleware)
- Proxy enforces public paths (`/`, `/terms`, `/privacy`, `/forgot-password`), role-home isolation, legacy `/dashboard` redirects
- Server actions in `app/actions/*.ts` (`"use server"`); forms use `useActionState` expecting `ActionResult { ok, error?, home?, id? }`
- Mutations re-check roles inside action (`requireRole`) — never trust the form alone
- After mutations: `revalidatePath("/", "layout")` (users page uses `"/admin/users"`)

### Domain Rules
- `customer.creditLimitDays` = payment term in **days**, not money, and is **OPTIONAL** (`null` = automatic). Overdue = unpaid past `saleDate + creditLimitDays`; the sales-overdue maths keeps its own `?? 30` fallback for null (`lib/credit.ts`). Use `dueDate(saleDate, creditLimitDays)` helper.
- **Term display precedence** — one helper, `partyTermDays()` in `lib/pendingBills.ts`, resolves the term shown on BOTH the Customers "Terms (Days)" cell and the Pending Bills "Credit Term" column: (1) stored `creditLimitDays` **> 0** (single number, beats Min/Max override even when both exist), (2) Min/Max override (`termMinDays` **> 0** / `termMaxDays` — max 0/null = single number), (3) range derived from the party's open bills (`billDate→dueOn` gaps) — **Customers only**: it passes `billTermMin`/`billTermMax`; **Pending Bills omits them**, so its level 4 is the per-bill gap, (4) null → Customers renders "-", Pending Bills falls back to the bill's own individual gap. **A stored 0 is display-skipped** (falls through like blank) — display-only: the sales-overdue maths still treats `creditLimitDays = 0` as due-same-day and the form still stores a typed 0. The Credit Term **filter** still matches the per-bill gap (`creditLimitDays` row field) — deliberately separate from the column.
- `CustomerCreditRow` carries BOTH `creditLimitDays` (never null — has the `?? 30` fallback; dashboards/chat read this one) and `rawCreditLimitDays` (stored value, nullable; the list cell resolves precedence from it). `PendingBillRow.partyTerm` = `{ min, max } | null` resolved server-side per row.
- **Two registers, `outstanding` = bills only.** `getCustomerCredits` returns `totalSales` + `billsOutstanding` (sum `PendingBill.pendingAmount`) + `totalBilled`. **`outstanding === billsOutstanding`** — sale balances deliberately NOT added (double-counts). `allocatePayment` lowers `pendingAmount`, so `billsOutstanding` is already net of approved payments.
- **Never reintroduce `outstanding = totalSales - totalCollected`** — disagrees with Pending/Completed Bills pages, goes negative for most parties.
- Customer list Status column derives from **bills register** (`billsMaxOverdueDays`), not sales. Status filter (`?status=overdue|within`) still uses sales register.

### Customer Approval Workflow
- `approvalStatus: "pending" | "approved"` (default pending)
- New customers start pending; visible only to admin or creator
- Sale/payment actions reject non-approved customers
- Admin approves via `approveCustomerAction` in `app/actions/customers.ts`
- **Edit rules** (easy to break):
  - `approvalStatus` NOT in `$set` — keeps admin-only approval meaningful
  - Rename cascades to `PendingBill.partyName` via `updateMany({ customerId }, { $set: { partyName } })`
  - Rename rejected if new name taken (case-insensitive whole-name)
- **Delete = admin-only**, refuses if customer has any Sale/Payment/linked PendingBill

### Entry Tracking
- `createdBy`/`approvedBy`/`ActivityLog.userId` = **real BSON ObjectIds** (`new Types.ObjectId(user.id)`)
- Names/roles resolved from `User` collection at read time (batched query)
- **Normalize with `String(value)` before comparing to session id** — ObjectId `===` string is always false
- `createdByRole` = entry-time snapshot of department (`primaryRole(user.roles)`), used for "Entered By" column + `dept` filter — NOT the removed `department` field
- Legacy rows keep string values; read path tolerates both

### Dropdown System
- 6 types in `lib/types.ts` `DROPDOWN_TYPES`: `category`, `branch`, `billCategory`, `paymentType`, `bankType`, `bankName`
- Constants (`CUSTOMER_CATEGORIES`, `PAYMENT_TYPES`, etc.) in `lib/types.ts` — **never import mongoose models into client components**

### Register Lists (Sales · Customers · Payments · Pending/Completed Bills)
- **Pagination:** all four list views paginate at `PER_PAGE = 20` via `lib/pagination.ts` (`parsePage`, `paginate`, `pageHref`) + `components/Pagination.tsx`. Slice happens **after** filtering/totals in the view — totals always reflect the full filtered set, only rows are sliced. `?page=` param; out-of-range clamps to last page. Pager hidden when `pages <= 1`.
- **Table chrome pattern:** `<div className="max-h-[70vh] overflow-x-auto">` → `<table className="table-dark table-sticky min-w-[…]">`. `.table-sticky` (globals.css) makes `thead th` sticky to the **container** top + pins the horizontal scrollbar to the container bottom (Edge-style). Use `background-color` longhand in the CSS — the shared shorthand breaks select arrows.
- **Filters auto-apply — no Apply button.** `components/FilterBarForm.tsx` (client) auto-submits on SELECT/date/number/checkbox change; **text/search boxes: Enter applies the search, but EMPTYING the box auto-submits** (clearing refreshes instantly, typing never fires per keystroke). Hidden `sr-only` submit button makes Enter work on every form (browsers skip implicit submission when a form has several fields and no submit button — Customers has one text field, the others don't). `Clear all` kept. `components/filters.tsx` exports `fstr`, `hasAnyFilter`, `optionList`, `FilterLabel` and must stay server-safe (no client hooks) — the form wrapper is the client boundary.
- Adding a new filter =: read param via `fstr` → add to `query` → add to `hasAnyFilter` keys (drives Clear visibility) → add a `FilterLabel` control. Filter values reuse `yes`/`no` with `{ $ne: true }` for the negative branch so legacy rows (field absent) count as false.
- Payments list also carries boolean columns `isDiscounted`/`isVat`/`isTaxAit` (set by checkboxes on `PaymentForm`) — Yes/No pills, filtered with `discounted`/`vat`/`taxAit` params. Table `min-w-[1300px]`.

## Pending Bills (Manual Register)

- Collection: `PendingBill` (`lib/models/PendingBill.ts`) — NOT derived from Sale/Payment
- `partyName` = free text; form offers Customer names as `<datalist>` suggestions
- `customerId` link maintained but **never authoritative** — `partyName` stays source of truth
- Columns: A `billDate` · B `referenceNo` (composite: `<billNum> dt.<d>.<m>.<y>`) · C `partyName` · D `openingAmount` · E `pendingAmount` · F `dueOn` · G `overdueDays` (manual, default 0) · H `note` (export only)
- **Col B is composite string** — no bill-number form field/Excel column. Number parsed from reference, persisted as `billNumber` (queryable, never typed). `referenceNo` stored/exported verbatim.
- `billNumber` + `departments` **always recomputed** from `referenceNo` by `deriveFromReference()` on every create/update/import. Editing `TS-1854` → `S-1854` moves row between apps on same `_id`.
- **Department routing** (`BILL_ROUTES` in `lib/pendingBills.ts`): `TS`→consumable, `CW`→esbd, `WO`→eid, `S`→sales, else `[]`=Accounts only. Longest prefix wins. `WO`=EID only. `departments` is array.
- **Accounts/Admin see EVERY bill** (no routing filter); department app filters `{ departments: <role> }`; unrouted (`[]`) never match = Accounts-only.
- **Writes re-check scope** — `canWriteBill(user, bill.departments, bill.assignedTo)` in `lib/pendingBillsData.ts` on update/delete; department edit pages pass `department="<role>"` so `PendingBillEditView` 404s on wrong app's bill.
- **Parsing never rejects save** — `parseReferenceNo()` returns warnings, never errors. Col A authoritative for bill date; embedded date mismatch = amber warning.
- **Col G (`overdueDays`) is MANUAL** — user types aging; does NOT track `dueOn` or "today". `0`/blank = not due (renders blank). Stored value = single source of truth for cell, filter, sort, header count.
- **Credit Term column** shows the party's stored term (creditLimitDays > 0 → termMinDays > 0 override) via `partyTermDays()` — otherwise **each bill's own individual gap** (`billDate→dueOn`). **No party-derived range in this column** (the Customers list still has level 3 — different fallbacks, shared helper). The term **filter** still matches the per-bill `creditLimitDays` gap — column and filter are deliberately different sources.
- **Bill age (`daysSinceBill`)** = whole days from `billDate` to today, recomputed on every read in `selectPendingBills`. `minDays`/`maxDays` filters translate to `billDate` window in query.
- List query **always** carries `pendingAmount: { $gt: 0 }` — settled bills drop off. `pendingAmount === 0` on save succeeds but returns warning (row hidden).
- `route` (where bill routed from bill number) vs `dept` (who entered it from `createdByRole`) — two different params. `route=unrouted` puts `$or` at top level of query.
- **Totals from final `rows` array**, never parallel `countDocuments()`.
- Rows shared (not per-entry scoped) — EXCEPTION: sales app is work-allocated (see below).

## Follow-Ups (Phone Calls)
- `followUps` = embedded array: `{ date, note (required, max 500), estimatedPaymentDate (optional), createdBy: ObjectId<User>, createdByRole }`. Append-only; sequence = array position.
- Promise = per follow-up; list shows newest with date (`lastPromisedDate`). Walks array newest→oldest for first entry with date.
- `promisedPassed` derived in data layer (not render) to avoid hydration mismatch at midnight.
- Promised-date filters applied in JS (not Mongo) — can't match "last element of array".
- `addFollowUp` re-checks `canWriteBill` + refuses `pendingAmount <= 0`. Its gate is `requireRole(...PENDING_BILL_ROLES, "eid_juniors")` — the one action that names a role outside `PENDING_BILL_ROLES`; do not "clean it up" by adding `eid_juniors` to that array (it would open create/import too).

## Excel Import/Export
- Real `.xlsx` via `exceljs@4.4.0` (MIT). **Do not add npm `xlsx`** (frozen at 0.18.5 with CVE).
- `next.config.ts` needs `experimental.serverActions.bodySizeLimit: "10mb"` + `serverExternalPackages: ["exceljs"]`.
- `lib/pendingBills.ts` = mongoose-free (parse, routing, validation); `lib/pendingBillsData.ts` = DB queries
- Import de-duplicates on **bill number + party** (`pendingBillKey`), not whole reference. Updates preserve `createdBy`/`createdByRole`.
- Good rows imported, bad rows reported — ref-no parse problems = warnings (separate array). `IMPORT_MAX_ROWS = 5000`.
- Export routes use `getSession()` + `hasRole()` returning 403 (not `requireRole` which redirects).
- `PendingBillImportButton` calls action directly in `useTransition` (no form/ref).
- **Customers** has the same trio (`lib/customersExcel.ts` columns+reader+writer, `lib/customersExport.ts` handler, `app/*/customers/export/route.ts` × 8). 10 columns A–J (Name … Term Max); no approval column — `approvalStatus` is never written by `importCustomers` (new rows = pending, same as `createCustomer`). De-dupes on **case-insensitive whole name** (the same identity `ensureCustomerForParty` uses); matched → update in place + rename cascades to `PendingBill.partyName`; **blank/0 cells are SKIPPED, never written** — a re-imported export can only fill values in, never wipe a stored term/group/contact (day columns are written only when > 0); the list pipeline itself lives in `lib/customersList.ts` (`listCustomers`) so export == screen. `components/CustomerImportButton.tsx` mirrors the bills button.

## Branches (Branch-Prefix Routing)
- Department app at `/branches`, cloned from `consumable`
- `Branch` collection: `name`, `prefix` (uppercase, 2+, unique, not TS/CW/WO/S/W), `active`, `note`, `createdBy`. Admin-only at `/admin/branches`.
- `User.branchId` (ObjectId ref Branch, indexed) separate from `User.department`. Set from Users page; written to session at login.
- **Routing additive, append-only** in `routeReference()`: (1) branch prefix anywhere in reference → push `branches` first, (2) `BILL_ROUTES` unchanged, (3) standalone `W` → eid.
- `branches` pushed first so `pendingBillHome()` links to branch register. Branch-routed + dept-routed bill visible in both; landing page = branch.
- **No backfill** — only rows written/imported after branch exists carry `branchId`/`branchName`. `branchName` = write-time snapshot.
- Read fallback stays department-only — do not add branch fallback in `selectPendingBills`.

## Sales Work Allocation (`assignedTo`)
- **Sales app is work-allocated** — salesperson sees only rows handed by Accounts/Admin. Other apps = open register.
- `assignedTo` (ObjectId<User>, indexed) on `PendingBill` AND `Sale` — separate from `createdBy`/`entryBy` (immutable audit). `assignedTo` = mutable work queue.
- **One decision, one helper:** `salesAssigneeClause(roles, userId, department)` in `lib/nav.ts` returns `{ assignedTo: userId }` or `null`. Lists, exports, write guards all call it.
- Fails closed; skipped for non-sales departments. `null` department (Accounts/Admin) = scoped, never unrestricted.
- **Scoping = READ and WRITE** — `canWriteBill`/`canWriteSale` re-apply clause on update/delete/addFollowUp. Views must pass `assignedTo` — omitting it silently falls back to unrestricted.
- `assignedTo` written in 3 places only: `app/actions/distribute.ts` (Accounts/Admin), `assigneeForNewRow` on insert, backfill script. **Never in row-save `$set`.**
- Only `departments: "sales"` rows distributable. Assignees must be active users with `sales` role.
- Unassigning = same code path with empty `assigneeId` → `$set: { assignedTo: null }`.

## Payment Approval & Completed Bills
- New payments = `pending` (`approvalStatus: "pending"`). Only `"approved"` counts toward collected/outstanding/overdue.
- Approval: Accounts + Admin via `approvePayment` in `app/actions/payments.ts` (`PAYMENT_APPROVER_ROLES`). Self-approval blocked.
- Payment flags `isDiscounted` / `isVat` / `isTaxAit` = booleans (`default: false`, indexed) on the model; `formData.get(x) === "on"` in `createPayment`. No payment edit route — flags are create-time only.
- **Bill picked on payment form settled FIRST, then FIFO.** `planAllocation(bills, amount, preferredBillRef)` moves that bill to head before splitting. `matchesBillRef` matches short number or full composite reference case-insensitively.
- Allocation reads `pendingAmount > 0` bills matched by `customerId` + case-insensitive name fallback. Excess = `unallocatedAmount`. Bill hits `pendingAmount = 0` → falls out of pending list, appears on Completed.
- **Crash-safe:** claim (`pending`/`allocating` → `allocating`) → persist plan → conditional bill updates → approve. Retry idempotent. **Must call `allocatePayment` on `pending` payment** — pre-setting `approved` returns `alreadyApproved: true` and moves no money (silent failure).
- Completed bills = `PendingBillsView` with `completed` prop (`pendingAmount <= 0`). Routes in every app **except `/eid_juniors`** (8 routes).

## Forms (Canonical Pattern)
Mirror `CustomerForm.tsx` for all mutation forms (`SaleForm`, `PaymentForm`):
- `"use client"` + `useActionState` against server action returning `ActionResult`
- Theme-aware via `useTheme()` (no hard-coded dark-only surfaces)
- No in-card hero — page `PageHeader` supplies title/subtitle
- Icon section headers; optional `TooltipInfo`; error slot on fields
- Success/warning/error banners; right-aligned footer submit button
- Shared primitives: `components/form.tsx` (`SuccessBanner` / `ErrorBanner` / `Field`)

### Payment Auto-Fill
- Selecting customer copies **oldest** sale into form: `billNo`, `billDate`, `relatedSaleReferenceId`
- `PaymentNewView` passes `sales` as `SaleOption[]` sorted `{ saleDate: 1, referenceId: 1 }` (FIFO-first wins)
- Reference `<select>` shows only `referenceId` per option (no bill number)
- Fields = controlled React state (`billNo`/`billDate`/`relatedRef`) — **never** `document.getElementsByName`
- `branch` = React state, not DOM write (it's a `SearchSelect`)

### Party Pending Bills Card (Add Payment)
- Appears under customer select once `selected` set; **read-only, submits nothing**
- Fetched on demand per selection (not passed with page)
- Response tagged with id (`loaded: { id, data }`); fetch cancelled on cleanup
- **Not department-scoped** — answers "what does this party still owe" across all apps
- Bills matched on `customerId` + case-insensitive name fallback for unlinked rows
- `pendingAmount: { $gt: 0 }` only; `allSettled` distinguishes "no bills" vs "all paid"

## Auth
- Cookie: `cc_session` — HMAC-signed payload (`lib/session.ts`), httpOnly
- **DB field = `role` (array), session = `roles` (plural)** — trips scratch scripts. `User.find({ roles: "x" })` returns 0 docs silently; query `role` instead. For actor lookups: read `u.role`, wrap via `primaryRole(Array.isArray(u.role) ? u.role : [u.role])`
- Seeded users: password `<seeded-password>` (see `credentials.md` for emails + route map)

## UI Conventions
- Dark-first theme with light mode: `html.light` + CSS vars in `app/globals.css`
- Toggle: `components/ThemeToggle.tsx` (sidebar + mobile); state in `ThemeProvider` / `localStorage` key `cc-theme`
- Theme toggle border-running light (`.theme-toggle-ring`): animates CSS `@property --theme-toggle-angle` on conic-gradient — **do not `transform: rotate`**
- Cards/panels: solid dark backgrounds + `.solid-card` (light mode keeps light text)
- Page chrome: `.bg-theme` / `.text-theme` / `.border-theme`
- Active sidebar: `.nav-active` (dark text/icon in light mode) — don't force white text
- Sidebar nav scrollable (`.sidebar-nav`); scrollbar hidden; brand/user card fixed (`shrink-0`)
- Dashboard stat cards: two grids of 3 (`sm:grid-cols-2 lg:grid-cols-3` × 2) = 6 cards
- Tailwind v4 important modifier = trailing `!` (e.g. `text-white!`, `w-auto!`)
- Icons: `lucide-react` only. No component library.
- Currency: `formatBDT` / `formatDate` / `toDateInput` in `lib/format.ts` (? BDT)
- Shared classes: `.surface-card`, `.input-field` (use `background-color` longhand — shorthand breaks select arrow), `.table-dark`, `.btn-primary`, `.btn-ghost`, `.pill` / `.pill-{green,red,indigo,amber,zinc}`

### SearchSelect (Searchable Dropdown)
- `components/SearchSelect.tsx` (client-safe). Native `<select>` can't filter.
- Keeps real form value via **hidden input**; visible box = search input only.
- `name` optional; omitted = pure picker, no hidden input, submits nothing (`PartyBillPicker`)
- **Always merge field's current value into `options`** — stored value missing from options = silent data loss. `CustomerForm`/`PaymentForm` do this for `branch`.
- `className` effectively required — renders bare `<input>`. Pass theme-aware Tailwind string (from `useTheme()`), NOT `.input-field` (unlayered CSS padding beats utility, pushes buttons over text).
- `<ul>` renders only when `open` (real click) — server HTML can't prove dropdown populated. Assert against RSC payload/help line.

### Party Bill Picker (Pending Bill Form)
- Under Party Name: searchable list of party's **existing** bills. Picking fills **Bill Date AND Ref No together** (reference carries `dt.d.m.yyyy`).
- Bill Date stays native `type="date"` — picker is shortcut, not replacement.
- `partyName` = controlled state (required for picker to react)
- Suggestions keyed on free-text name (not Customer id); widens to `customerId` when name resolves
- Includes **settled** bills (`pendingAmount: 0`) — opposite of Add Payment card
- Debounced 250ms; response tagged with name fetched for
- `$or` at top level of query; capped at `SUGGEST_LIMIT = 25`

## Product References
- `prd.md` — requirements (schema shows money-style `creditLimit`; code uses `creditLimitDays`; **code is source of truth**)
- `credentials.md` — test logins + role → route table
- `chatbotdocumantation.md` — Credit Assistant intent/date/slot catalog (spelling intentional)
- `design.md` — login page visual spec (stale vs solid-card + theme system)
- `DEPLOYMENT.md` + `deploy-remote.ps1`/`.bat` — live server flow (PM2 on `<server-ip>:8002`, copy-source-then-build-on-server; `postbuild` runs `scripts/fix-standalone-chunks.mjs` for standalone output)
- `README.md` — untouched create-next-app boilerplate; it claims `app/page.tsx` is the starting point (it's the login page). Trust this file instead.
- `CLAUDE.md` — only `@AGENTS.md`

## Scratch Scripts
- Write temp files under `scripts/` as `*.mts` (not `.ts` — package has no `"type": "module"`, top-level `await` fails in CJS). Run with `npx tsx`, then **delete**.
- **To verify page renders, mint session cookie** — dev server rejects invalid cookie with silent 307 to `/?from=…`. Build token: `base64url(JSON.stringify({id,name,email,roles,exp}))` + `.` + HMAC-SHA256, both base64url, `roles` plural.
- PowerShell mangles non-ASCII on read — `৳`/`—` render as `?`. Read with `[System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($f))`, check for `U+FFFD` before "fixing".
- Write against **pure functions**, not live DB (`planAllocation`, `parseReferenceNo`, `daysSinceBill`, `deriveFromReference`, `partyTermDays`, `paginate`/`parsePage`, nav helpers, chat parsers — all exported, DB-free).
- Import with explicit `.ts` extension (`await import("../lib/plan.ts")`) — `tsc` flags `TS5097` on extensionless imports.
- Asserting HTML: RSC flight payload repeats ids/classes → match `href="…assigned=<hex24>"`, not bare `assigned=<hex24>`. Empty result = no table (`rows.length === 0` → `EmptyState`), not broken header.
- Register can be empty (0 bills, 0 sales) on seeded DB — `npm run seed` doesn't touch `PendingBill`. Re-count before concluding query broken.
- Mongo = standalone `mongod`, **no multi-doc transactions**. Mutating scratch scripts must snapshot changed fields, restore in `finally`, read back, print restored state.