# HardwareOps Optimizer — QA Checklist

This checklist covers browser, API, database, role, Finance, and desktop
packaging behavior in the current implementation. It is a test plan, not a
claim that each check has passed.

## 1. Test Run Record

Copy this section for each release candidate.

| Field | Value |
|---|---|
| Build / commit | |
| Tester | |
| Date | |
| Environment | Local / staging / packaged desktop |
| Database | Disposable test DB name only; never record credentials |
| Browser / OS | |
| Result | Not started / Pass / Fail / Blocked |

### Severity

- **Blocker:** data loss, unauthorized access, corrupted ledger/stock, or
  application cannot start.
- **Critical:** core workflow fails or produces incorrect financial/inventory
  state with no safe workaround.
- **Major:** important behavior fails, but a safe workaround exists.
- **Minor:** cosmetic or low-impact issue.

Record every failure with severity, exact reproduction steps, expected vs
actual result, role, request path (if relevant), and sanitized logs. Never
attach passwords, bearer tokens, full database URLs, or customer personal
data.

## 2. Safety and Test Setup

- [ ] Use a disposable local or staging PostgreSQL database.
- [ ] Confirm the effective `DATABASE_TARGET` and database name before running
  setup or test commands.
- [ ] Do not run `db.sql` or `npm run dist:win` against production or any
  database containing data that must be retained. `db.sql` drops tables with
  `CASCADE`.
- [ ] Use dedicated test accounts for each role. Do not use a production owner
  password.
- [ ] Keep `.env` private. Do not copy `.env` or packaged installer contents
  into tickets or chat.
- [ ] Start the API with the configured development database and confirm the
  expected local URL before testing.
- [ ] Record pre-test row counts or create a database snapshot when testing
  destructive or financial flows.
- [ ] Avoid real email, payment, or external service assumptions; current
  flows are local database operations.

### Test data checklist

- [ ] One active item with known cost, price, tax code, reorder point, and stock.
- [ ] One active supplier with known lead time and terms.
- [ ] One B2B customer with a known credit limit and terms.
- [ ] One consumer customer, if used by the test.
- [ ] One item available for stock reduction, GRN, and shrink scenarios.
- [ ] A disposable customer and item for mutation tests, where practical.
- [ ] Note starting inventory quantity, customer credit usage, invoice amounts,
  and journal totals before running financial cases.

### Important current implementation caveats

- `npm test` is a placeholder and exits with “no test specified”; do not report
  it as a passing automated suite.
- `npm run load-test` tests a concurrent set of selected GET/login routes and
  accepts valid 503 `database_busy` responses. It does not validate
  correctness, mutations, or financial calculations.
- Many operational routes are authenticated but do not have a module-specific
  permission middleware. Test authorization against the approved expected
  policy and report unexpected access as a security issue.
- The Accountant seed description says “Read-only financials”, but the
  `finance_edit` grant is true in the checked-in seed/bootstrap. Confirm the
  intended policy before accepting or changing this behavior.
- `npm run dist:win` creates/selects and initializes a database before it
  packages the app; if the database exists, confirmed `db.sql` execution
  replaces its application tables.

## 3. Build and Startup Smoke Tests

### Dependencies and API

- [ ] `npm install` completes on the supported test machine.
- [ ] `npm start` starts the API with the expected development database.
- [ ] `GET /` returns the application HTML.
- [ ] `GET /api/me` without a bearer token returns 401.
- [ ] `POST /api/login` with invalid credentials returns 401 and does not
  create a usable session.
- [ ] Valid login returns a token; `GET /api/me` with that token returns the
  authenticated user.
- [ ] `POST /api/logout` invalidates the current session.
- [ ] Reusing a logged-out token is rejected.
- [ ] An inactive user cannot log in and a deactivated user's sessions stop
  working.
- [ ] Browser login, refresh, and logout work without console errors.

### Database busy behavior

- [ ] If a safe test environment can reproduce PostgreSQL error `53300`, the
  API returns HTTP 503 with `{ "error": "database_busy" }` and
  `Retry-After: 2`.
- [ ] Confirm the browser retries GET requests only; it does not automatically
  replay mutations.
- [ ] Never induce resource exhaustion on a shared or production database.

## 4. Role and Permission Checks

Run UI checks and direct API checks. Hiding/disabling a button is not proof of
server-side access control.

| Role | UI areas expected from seeded grants | Checks |
|---|---|---|
| Owner | All panels; user management; permission editing | [ ] Can access approved screens and manage users/permissions |
| Manager | All operational panels except user management/permission editing | [ ] Confirm user and permission APIs deny where policy requires |
| Cashier | POS, Services, Rentals | [ ] Finance and inventory routes deny access |
| Storekeeper | Dashboard, Inventory, PO, GRN, Rentals, Shrink, Masters | [ ] Finance and POS routes deny access |
| Accountant | Dashboard, B2B, GMROI, Analytics, Number Series, Finance | [ ] Verify whether Finance editing is intended; currently granted |

- [ ] Verify the visible nav matches the seeded permission matrix.
- [ ] Attempt protected API GETs directly as each test role.
- [ ] Attempt protected API POST/PUT/DELETE requests directly as each role.
- [ ] Confirm unauthorized requests return 403 (not success or a data-bearing
  response).
- [ ] Confirm expired, missing, malformed, and revoked tokens return 401.
- [ ] Verify user-management and password-change behavior against the intended
  policy, including self-service and Owner restrictions.
- [ ] Verify a permission edit persists and affects a subsequent request.
- [ ] Confirm permissions are actually updated for an existing row; current
  Finance bootstrap seeding uses `ON CONFLICT DO NOTHING`.

## 5. Module Regression Checklist

### Dashboard

- [ ] Open Dashboard as each role granted `dashboard`.
- [ ] Confirm KPI cards render and no section throws a browser error.
- [ ] Compare inventory value and retail value to test inventory rows.
- [ ] Compare low-stock count to each item quantity and reorder point.
- [ ] Compare open PO count, unpaid invoices, and sales cards to the current
  application data.
- [ ] Verify the dashboard indicates the active VAT toggle state.

### POS

- [ ] Add an item to the cart, change quantity, remove an item, and clear cart.
- [ ] Complete a taxable cash sale; verify API returns a sale ID.
- [ ] Verify sale header totals: subtotal, discount, tax, and total.
- [ ] Verify each sale line stores the expected item cost snapshot and quantity.
- [ ] Verify stock decreases exactly once by the sold quantity.
- [ ] Verify sale journal is balanced and references the sale.
- [ ] Repeat with tax disabled and compare expected tax.
- [ ] Use an eligible price tier and confirm configured discount calculation.
- [ ] Submit an invalid/empty cart and confirm it does not create partial data.
- [ ] Test `On Account (B2B)` with a customer; verify invoice creation and
  `credit_used` update.
- [ ] Verify the application does not claim credit-limit enforcement unless
  that behavior has been implemented and approved.
- [ ] Do not assert a full sales return/refund flow; it is not implemented.

### Inventory and Masters

- [ ] Load and search items; compare displayed quantity/cost/price to the DB.
- [ ] Create and edit an item with valid category, UOM, tax, supplier, and
  location values.
- [ ] Verify invalid references and malformed values return a clear error.
- [ ] Verify referenced master rows cannot be deleted when the database
  constraint protects them.
- [ ] Verify create/edit/delete permissions through direct API requests.
- [ ] Verify UOM factors and display precision are not silently changed by UI
  formatting.
- [ ] Verify all 12 master tabs render: Suppliers, Categories, Items,
  Customers, UOM, Tax Codes, Locations, Price Tiers, Brands, Payment Terms,
  Number Series, Users & Roles.

### Purchase Orders and GRN

- [ ] Create a PO with multiple valid item lines and confirm its identifier
  comes from the PO number series.
- [ ] Confirm expected date reflects supplier lead days.
- [ ] Receive the PO and verify GRN ID, supplier, lines, and receipt date.
- [ ] Verify PO becomes `Received` and each line increases inventory once.
- [ ] Verify a multi-line GRN produces one balanced `GRN` journal for the
  complete receipt.
- [ ] Confirm GRN VAT, inventory, AP, and total values against the configured
  item tax codes and explicit rounding.
- [ ] Test unknown PO, invalid lines, and duplicate/retry submissions.
- [ ] Do not treat partial receiving as supported; current route copies every
  PO line.

### B2B / Invoices / Receivables

- [ ] Confirm on-account POS sale creates an invoice with payment terms.
- [ ] Confirm AR aging includes open invoices and assigns buckets by due date.
- [ ] Receive a partial amount; verify paid amount, outstanding balance,
  customer credit usage, invoice status, and ledger effect.
- [ ] Receive the remainder; verify invoice is fully paid.
- [ ] Reject zero, negative, and over-balance receipts.
- [ ] Verify cancelled/paid invoices cannot be received again.
- [ ] Compare AR balances in the report to invoices' `total - amount_paid`.

### Services

- [ ] Create service ticket with valid customer, status, price, and notes.
- [ ] Verify it appears in the list with unchanged fields.
- [ ] Verify positive-price service posts one balanced `SERVICE` journal.
- [ ] Verify zero-price service does not post a journal.
- [ ] Confirm invalid enum status is rejected by the database.

### Rentals

- [ ] Create rental with valid tool, due date, daily rate, and late fee.
- [ ] Reject a due date earlier than checkout, non-positive rate, or negative
  late fee.
- [ ] Verify positive computed charge posts one balanced `RENTAL` journal.
- [ ] Verify rental list shows created values.
- [ ] Do not claim stock reservation, return, or availability handling unless
  separately implemented.

### Shrinkage

- [ ] Create a valid incident and verify incident value from item cost and
  quantity.
- [ ] Verify inventory decreases exactly once.
- [ ] Verify positive incident value produces one balanced `SHRINK` journal.
- [ ] Verify invalid reason and unknown SKU are rejected.
- [ ] Confirm a retry does not silently create duplicate incident/journal rows.

### Sales Analytics and GMROI

- [ ] Check summary for daily, weekly, and monthly date ranges.
- [ ] Compare item quantity, revenue, cost, and gross profit with source sale
  lines.
- [ ] Verify the item report excludes rows where `sales.is_return = TRUE`.
- [ ] Compare customer credit report with invoice/customer records.
- [ ] Compare supplier purchases with PO lines and PO statuses.
- [ ] Independently recompute `v_gmroi_category` from current inventory and
  item price/cost; document that this is a current-stock measure.
- [ ] Test empty date ranges and zero-stock categories.

## 6. Finance and Ledger Tests

Use an isolated database with known starting balances. Use a small controlled
amount and record the expected debit/credit lines before posting.

### Journal and reports

- [ ] Post a valid manual journal; confirm returned ID and journal lines.
- [ ] Reject fewer than two lines, negative amounts, both debit and credit on
  one line, and unbalanced totals.
- [ ] Verify `fn_post_journal` uses `fn_next_number('JE')`.
- [ ] Compare each journal's debit/credit totals within 0.009.
- [ ] Confirm trial-balance total debits and credits match.
- [ ] Compare ledger account totals to underlying journal lines.
- [ ] Confirm P&L totals use Revenue, COGS, and Expense account types.
- [ ] Confirm balance sheet equation is evaluated as Assets − Liabilities −
  Equity.
- [ ] Verify date filters include their boundary dates.
- [ ] Confirm journal dates come from source business dates where applicable.

### Automatic posting

- [ ] POS sale: verify cash/AR debit, revenue/VAT credit, and COGS/inventory
  movement balance as expected.
- [ ] GRN: verify inventory and VAT receivable debits, AP credit, and one entry
  per GRN.
- [ ] Service: verify AR and service revenue.
- [ ] Rental: verify AR and rental revenue.
- [ ] Shrinkage: verify shrinkage expense and inventory credit.
- [ ] Expense: verify category-mapped expense debit and cash credit.
- [ ] Invoice receipt: verify cash debit and AR credit for the amount-paid
  difference.
- [ ] AP payment: verify AP debit and cash credit.
- [ ] Fixed asset acquisition: verify fixed asset debit and cash credit.
- [ ] Depreciation: verify period validation, one posting per `YYYY-MM`, and
  accumulated-depreciation update.
- [ ] Verify an exception rolls back both the business mutation and its
  journal posting when they share a transaction.

### VAT, currency, period locks, and duplicate protection

- [ ] Verify POS VAT applies configured item tax rates only when tax is
  enabled.
- [ ] Verify GRN VAT uses the current database calculation and matches test
  expectations; do not assume PO prices use the same inclusive/exclusive
  convention as POS.
- [ ] Verify VAT return totals are filtered by inclusive `from` and `to` dates.
- [ ] Verify monetary values are rounded consistently to two decimal places.
- [ ] Add a period lock and confirm an entry on the lock-through date and an
  earlier date is rejected with HTTP 422.
- [ ] Confirm an entry after the lock-through date succeeds.
- [ ] Verify duplicate depreciation request for the same month returns 409.
- [ ] Verify source/ref idempotency for event paths that implement it.
- [ ] Run the source/ref duplicate query and investigate all duplicate pairs;
  the schema does not provide a general unique constraint for `(source, ref)`.
- [ ] Reconcile cash/bank movement to direct account movement. Do not treat
  the current Cash Flow report as an indirect-method statement.

## 7. API Contract and Error Handling

- [ ] Collections return valid JSON arrays; create endpoints return documented
  IDs/results.
- [ ] Invalid inputs return an appropriate 4xx status and JSON error.
- [ ] Missing records return 404 where the endpoint defines not-found handling.
- [ ] Duplicate/conflicting actions return 409 where implemented.
- [ ] Database busy returns 503 and `Retry-After: 2`.
- [ ] Unexpected database errors are not converted to success-shaped results.
- [ ] Browser forms surface rejected requests and remain usable after failure.
- [ ] Mutating requests are not duplicated by browser retry logic.
- [ ] SQL request values are parameterized; no untrusted value is interpolated
  into SQL identifiers or query text.
- [ ] HTML output escapes user-controlled values; the generic `table()` helper
  itself does not escape cell markup.

## 8. Windows Desktop Packaging QA

**Warning:** this build runs database setup before packaging. Use a disposable
company database and test credentials only.

### Preflight

- [ ] Run on a supported Windows build machine with Node/npm installed.
- [ ] Dependencies are installed, including Electron and electron-builder.
- [ ] The repository `.env` contains valid test database configuration.
- [ ] Confirm whether target is `local` or `aiven`; setup defaults to `local`.
- [ ] Confirm the company name will normalize to the intended database name.
- [ ] Confirm the selected database is disposable or approved for table
  replacement.
- [ ] Confirm `.env` has no production credentials that must not be embedded.
- [ ] Confirm PostgreSQL client/service access. If local `psql` is missing, the
  Windows script attempts to install PostgreSQL 16 with `winget`.

### Build command

```powershell
npm run dist:win
```

- [ ] The `predist:win` lifecycle runs `node setup-database.js`.
- [ ] Enter the company name and selected database target.
- [ ] For local target, verify PostgreSQL service startup and use the intended
  superuser password; press Enter only when the test password is actually
  `postgres`.
- [ ] For Aiven target, verify `DATABASE_URL_AIVEN` points to the intended
  test project; the setup applies the configured project host/port and SSL.
- [ ] If database already exists, verify the destructive schema confirmation
  names the expected database before answering yes.
- [ ] Verify the database setup reports successful `db.sql` application.
- [ ] Verify the repository `.env` was updated with the selected target and
  database URL; do not display or commit its contents.
- [ ] Confirm electron-builder runs only after setup succeeds.
- [ ] Confirm an NSIS Windows installer is produced under `dist/`.
- [ ] Confirm the expected app name and install/uninstall entries in the
  installer.
- [ ] Confirm cancelling setup or forcing a setup failure prevents packaging.

### Installed application

- [ ] Install the produced installer on a clean Windows test account/machine.
- [ ] Launch the app; verify it starts the local API on loopback and opens the
  existing interface.
- [ ] Sign in with the test Owner and verify a basic read and write workflow.
- [ ] Close the app and verify its local API process shuts down.
- [ ] Relaunch and verify database configuration remains correct.
- [ ] Test configured user-data `.env` behavior for non-database settings.
- [ ] Verify installer and installed resources are access-restricted because
  packaged `.env` may expose database credentials.
- [ ] Verify no real credentials are present in the distributed installer.

### Packaging side-effect review

- [ ] Compare the repository `.env` before/after using a secure local method;
  confirm unrelated variables/comments remain.
- [ ] Confirm the installer connects to the selected company database, not a
  stale or production database.
- [ ] Confirm expected application tables and seed data exist after setup.
- [ ] Record the exact installer filename/version and its SHA-256 in the
  release record; do not upload the installer to an untrusted location.

## 9. Load and Concurrency Checks

The built-in load test requires `AUTH_BOOTSTRAP_EMAIL` and
`AUTH_BOOTSTRAP_PASSWORD`. It defaults to 56 concurrent requests and requires
`LOAD_TEST_CONCURRENCY >= 56`. Run against a dedicated test server and
database, never production unless separately approved.

```sh
LOAD_TEST_BASE_URL=http://localhost:4000 \
LOAD_TEST_CONCURRENCY=56 \
AUTH_BOOTSTRAP_EMAIL='qa-owner@example.test' \
AUTH_BOOTSTRAP_PASSWORD='use-a-test-secret-of-12-or-more-characters' \
npm run load-test
```

- [ ] Confirm each response is successful or a valid `database_busy` 503 with
  `Retry-After`.
- [ ] Record response distribution and server-side pool-exhaustion logs.
- [ ] Confirm the app remains usable after the run and the database has no
  leftover open transaction.
- [ ] Do not interpret an accepted 503 as a passed business workflow.
- [ ] Do not use this script to test writes or financial mutation idempotency.

## 10. Release Gate

- [ ] No unresolved Blocker or Critical defects.
- [ ] All changed modules pass their applicable regression cases.
- [ ] Role access was tested directly at the API.
- [ ] Ledger and inventory invariants pass for tested transactions.
- [ ] Database setup and rollback/recovery plan are approved.
- [ ] Windows installer passes both build and installed-app checks when a
  Windows build is part of the release.
- [ ] `.env`, credentials, bearer tokens, and production data are excluded
  from source control and release evidence.
- [ ] Known gaps and accepted risks are recorded with an owner and follow-up
  change request.

### QA issue template

```markdown
### QA-NNN: <Short title>
**Severity:** Blocker | Critical | Major | Minor
**Build / commit:** <identifier>
**Environment:** <OS, browser, API target; no secrets>
**Role:** <test role>
**Preconditions:** <test data and initial state>
**Steps:**
1. <step>
**Expected:** <result>
**Actual:** <result>
**Evidence:** <sanitized logs/screenshots/request status>
**Reproducible:** Always | Intermittent | Once
**Related change request:** <CR-NNN or none>
```
