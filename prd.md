==================================================================
PRODUCT REQUIREMENTS DOCUMENT (PRD)
CREDIT CONTROL WEB APPLICATION
==================================================================

Document Version: 1.0
Date: September 22, 2026
Tech Stack: React (Next.js) + MongoDB
Prepared From: Credit Control Web Application - System Flow (flowchart)

------------------------------------------------------------------
1. OVERVIEW
------------------------------------------------------------------
The Credit Control Web Application is an internal business tool
used to manage customer/company credit limits, track sales made to
customers, record payment collections against those sales, and
monitor outstanding dues across departments (Sales, EID, ESBD,
Consumable, Accounts). The system is role-based, meaning each user
sees a different panel and has different permissions depending on
their role. All data is centralized in a single MongoDB database
shared across all departments.

------------------------------------------------------------------
2. GOALS & OBJECTIVES
------------------------------------------------------------------
- Provide a single source of truth for customer credit limits and
  payment collection records.
- Allow department users (Sales, EID, ESBD, Consumable) to view
  customers and submit payment collection entries.
- Allow the Accounts department to:
    a) Add/manage customers and companies (with credit limits).
    b) Record every SALE made to a customer/company, each sale
       tagged with a unique Reference ID (new requirement).
    c) Record payment collections against outstanding dues.
- Allow Admin to have full visibility and control: credit limit
  status, outstanding dues, payment history, user/role management,
  reports, and alerts for customers exceeding their credit limit.

------------------------------------------------------------------
3. USER ROLES & ACCESS
------------------------------------------------------------------
Authentication: Role-Based Login (single login page, role
determined after authentication).

Roles identified from flowchart:
1. ESBD (Other Users group)
2. Consumable (Other Users group)
3. Sales (Other Users group)
4. EID (Other Users group)
5. Accounts
6. Admin

3.1 OTHER USERS (ESBD / Consumable / Sales / EID)
Access:
  - View Customer List (read-only, filtered/general)
  - Add Payment Collection Entry (via shared Payment Collection
    Entry Form)
Cannot:
  - Add/edit customers
  - Add sales entries
  - View admin reports

3.2 ACCOUNTS
Access:
  - View Customer List
  - Add Customer / Company
      * Customer/Company Name
      * Department
      * Credit Limit
      * Branch
  - Add Sale Entry (NEW REQUIREMENT)
      * Recorded every time the customer/company purchases from
        the business
      * Each sale generates/uses a unique Reference ID
      * Updates customer's outstanding balance against credit
        limit
  - Add Payment Collection Entry

3.3 ADMIN
Access (full oversight, read-mostly + user management):
  - Credit Limit Status (Within Limit / Over Limit)
  - Outstanding Due Amount per Customer (Credit Limit - Total
    Collected)
  - All Payment History (Collection Records)
  - View All Customers & Company Records
  - Department-wise Summary (Accounts / Sales / EID / ESBD /
    Consumable)
  - Overdue / Alert List (customers exceeding credit limit)
  - Reports & Export (PDF / Excel)
  - Entry-by / Assigned Person Activity Log
  - Payment Type & Bank-wise Breakdown
  - Manage Users & Roles (Add / Edit / Remove access)

------------------------------------------------------------------
4. CORE MODULES / FEATURES
------------------------------------------------------------------

4.1 Login & Authentication
  - Email/username + password login
  - Role detected after login, redirects to respective dashboard
  - Session/JWT-based auth

4.2 Central Database
  - Stores: Customers, Companies, Sales Records, Payment Records,
    Users
  - Shared/central source accessed by all panels

4.3 Customer / Company Management (Accounts, Admin - view)
  Fields:
  - Customer/Company Name
  - Address (optional)
  - Contact Person Name (optional)
  - Contact Number (optional)
  - Category (optional: Retail/Wholesale/Corporate/Government/Distributor/Other)
  - Group (default: "Not a Group of Company")
  - Credit Limit (days)
  - Branch (optional)
  Sale reference IDs (`SALE-YYYY-NNNN`) are set when creating a sale, not on the customer.
  Customer department is not stored (department lives on User accounts only).

4.4 Sales Entry Module (NEW - Accounts only)
  Purpose: Every time Accounts records that a customer/company has
  purchased from the business, a new Sale record is created.
  Fields:
  - Sale Date
  - Customer/Company Name (linked to customer record)
  - Reference ID (auto-generated, unique per sale; also
    manually assignable if required)
  - Product/Item or Description (optional/free text)
  - Sale Amount
  - Entry By (Accounts user)
  Business Rule:
  - Each sale increases the customer's "Total Sales" and therefore
    affects Outstanding Due = Total Sales - Total Collected
  - System should warn/alert if a new sale pushes the customer
    Over Credit Limit

4.5 Payment Collection Entry Form
  Accessible by: Accounts, Sales, EID, ESBD, Consumable
  Fields:
  - Rcv Date
  - Customer Name | Branch
  - Bill Category | Bill No | Bill Date
  - Payment Type | Rcv Amount
  - Bank Type | Bank Name
  - Assigned Person | Entry By
  - (Recommended addition) Reference ID of the related Sale, to
    link payment to a specific sale for accurate reconciliation
  Action: "Submit Entry" -> saved to Central Database as a Payment
  Record

4.6 Customer List View (All roles)
  - List of customers/companies
  - Search/filter by name, category, group
  - Shows credit limit, outstanding balance (role-dependent detail
    level)

4.7 Admin Dashboard
  - Credit Limit Status widget (Within Limit / Over Limit)
  - Outstanding Due per customer = Credit Limit - Total Collected
    (to be updated to: Total Sales - Total Collected, since sales
    are now tracked separately from credit limit)
  - All Payment History (filterable table)
  - All Customer & Company Records
  - Department-wise Summary
  - Overdue/Alert List (auto-flag customers exceeding credit limit
    or with overdue balances)
  - Reports & Export (PDF/Excel)
  - Activity Log by Entry-by / Assigned Person
  - Payment Type & Bank-wise Breakdown (charts/tables)
  - Manage Users & Roles (CRUD for user accounts, assign roles)

------------------------------------------------------------------
5. UPDATED BUSINESS LOGIC (with Sales Entry addition)
------------------------------------------------------------------
Previously (per flowchart): 
  Outstanding Due = Credit Limit - Total Collected

Updated logic (with new Sales module):
  Total Sales (Company/Customer) = SUM of all Sale records for
      that customer
  Total Collected = SUM of all Payment Collection records for
      that customer
  Outstanding Due = Total Sales - Total Collected
  Credit Status:
      - "Within Limit"  -> Outstanding Due <= Credit Limit
      - "Over Limit"     -> Outstanding Due > Credit Limit

Each Sale record and each Payment record should store a
Reference ID so that transactions can be traced/reconciled
against each other in reports.

------------------------------------------------------------------
6. SYSTEM FLOW (based on flowchart)
------------------------------------------------------------------
1. Start -> Login Page (Role-Based Authentication)
2. Check User Role:
   - ESBD / Consumable / Sales / EID -> Other Users Panel
       -> View Customer List
       -> Add Payment Collection Entry -> Payment Collection
          Entry Form -> Submit Entry -> Central Database
   - Accounts -> Accounts Panel
       -> Add Customer/Company -> Central Database
       -> Add Sale Entry (NEW) -> Central Database
       -> View Customer List
       -> Add Payment Collection Entry -> Payment Collection
          Entry Form -> Submit Entry -> Central Database
   - Admin -> Admin Dashboard
       -> Credit Limit Status
       -> Outstanding Due Amount per Customer
       -> All Payment History
       -> View All Customers & Company Records
       -> Department-wise Summary
       -> Overdue/Alert List
       -> Reports & Export
       -> Entry-by/Assigned Person Activity Log
       -> Payment Type & Bank-wise Breakdown
       -> Manage Users & Roles

------------------------------------------------------------------
7. PROPOSED DATABASE SCHEMA (MongoDB Collections)
------------------------------------------------------------------

7.1 users
  {
    _id, name, email, passwordHash, role: 
        ["esbd","consumable","sales","eid","accounts","admin"],
    department, status(active/inactive), createdAt, updatedAt
  }

7.2 customers
  {
    _id, name, address, contactPerson, contactNumber, category, group, creditLimitDays,
    createdBy, createdAt, updatedAt
  }

7.3 sales   (NEW COLLECTION)
  {
    _id, referenceId (unique), customerId (ref: customers),
    saleDate, description, amount, entryBy (ref: users),
    createdAt, updatedAt
  }

7.4 payments
  {
    _id, rcvDate, customerId (ref: customers), branch,
    billCategory, billNo, billDate, paymentType, rcvAmount,
    bankType, bankName, assignedPerson, entryBy (ref: users),
    relatedSaleReferenceId (optional link to sales.referenceId),
    createdAt, updatedAt
  }

7.5 activityLogs
  {
    _id, userId, action, module, recordId, timestamp
  }

------------------------------------------------------------------
8. TECHNICAL ARCHITECTURE
------------------------------------------------------------------
Frontend: Next.js (React) - App Router, role-based route
   protection (middleware), server components for dashboards,
   client components for forms
Backend: Next.js API Routes (or separate Node/Express service)
Database: MongoDB (Mongoose ODM recommended)
Auth: NextAuth.js or custom JWT-based auth with role claims
State Management: React Context / Zustand (for form & session
   state)
Styling: Tailwind CSS
Reports Export: PDF (e.g., pdf-lib / puppeteer), Excel (e.g.,
   exceljs / SheetJS)
Charts: Recharts or Chart.js (for Admin dashboard breakdowns)
Hosting: Vercel (Next.js) + MongoDB Atlas

------------------------------------------------------------------
9. NON-FUNCTIONAL REQUIREMENTS
------------------------------------------------------------------
- Role-based access control enforced both on frontend routes and
  backend API endpoints
- All monetary fields validated as positive numbers
- Reference IDs must be unique (indexed in MongoDB)
- Audit trail: every Add/Edit/Delete action logged with user,
  timestamp, and module
- Data validation on all forms (client + server side)
- Responsive UI (desktop-first, usable on tablets)
- Alerts/notifications when a customer crosses credit limit
- Scalable to handle growing number of customers/sales/payments

------------------------------------------------------------------
10. FUTURE ENHANCEMENTS (Optional)
------------------------------------------------------------------
- Email/SMS alerts to Admin when a customer goes Over Limit
- Customer-facing portal to view their own outstanding balance
- Automatic reference ID generation with configurable prefix
  (e.g., SALE-2026-0001)
- Multi-currency support
- Integration with accounting software (e.g., QuickBooks, Tally)

==================================================================
END OF DOCUMENT
==================================================================