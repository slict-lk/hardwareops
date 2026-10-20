# HardwareOps Optimizer — project.md

> Living engineering reference for the current checked-in implementation.
> The code, not this document, is authoritative when they disagree. Update
> this document in the same change as any behavior or schema change it describes.

## 1. Project Snapshot ("the one-liner")

HardwareOps Optimizer is a browser-based operations and finance application
for a hardware retailer. It combines point-of-sale, inventory, purchasing,
customer credit, store services, rentals, shrinkage, analytics, and a general
ledger in one application.

The application uses an Express 5 API, PostgreSQL, and a vanilla-JavaScript
single-page interface. A cross-platform Electron desktop wrapper is also
included in the repository.

The seeded business context is Sri Lankan: LKR is displayed and tax masters
include VAT rates of 18%, 8%, and 0%. Tax configuration and reporting behavior
in this application are not a substitute for statutory or accounting advice.

| Attribute | Current value |
|---|---|
| App name | HardwareOps Optimizer |
| Version | `1.0.0` (`package.json`) |
| Owner | Not specified in `package.json`; seeded database includes an Owner role |
| Stack | Node.js ESM, Express 5, `pg`, PostgreSQL, vanilla JavaScript, HTML/CSS; Electron wrapper |
| DB | PostgreSQL; connection target is environment-configured |
| Host | Configurable through `DATABASE_URL` or target-specific database URL variables |
| Currency | LKR; rendered as `Rs` using `en-LK` number formatting |
| Locale | `en-LK` for currency display; no broader locale configuration is defined |
| Tax regime | Tax master includes VAT18, VAT8, VAT0, and NONE; application tax calculations use configured rates |
| Auth model | Email/password login; scrypt password hashes; opaque bearer token with SHA-256 hash stored in `auth_sessions` |
| Session model | Server-side session rows expire after 12 hours; browser stores the raw token in `sessionStorage.hardwareopsSession` |
| Deployment model | Express app can run locally or as a Vercel serverless app; Electron desktop packaging is configured |
| Target users (roles) | Owner, Manager, Cashier, Storekeeper, Accountant |

**North Star:** Give a hardware retailer one consistent view and workflow for
selling, stocking, servicing, renting, and accounting for goods.

### Current module inventory

“Shipped” here means a visible panel and/or corresponding API/schema behavior
exists in the checked-in source. It does not imply complete access control,
compliance certification, or exhaustive workflow coverage.

- ✅ Shipped — Dashboard
- ✅ Shipped — POS
- ✅ Shipped — Inventory
- ✅ Shipped — Purchase Orders (PO)
- ✅ Shipped — Goods Received Notes (GRN)
- ✅ Shipped — Services
- ✅ Shipped — Rentals
- ✅ Shipped — B2B / Credit
- ✅ Shipped — Shrinkage
- ✅ Shipped — GMROI
- ✅ Shipped — Sales Analytics
- ✅ Shipped — Masters (12 tabs)
- ✅ Shipped — Users & Roles
- ✅ Shipped — Finance (15 tabs)

### Core file map

| File | Primary responsibility |
|---|---|
| `server.js` | Express application, API routes, auth, finance schema bootstrap, startup and server lifecycle |
| `db.sql` | PostgreSQL base schema, seeded roles and masters, stock/accounting functions and triggers, analytics views |
| `index.html` | Single-file browser UI: markup, styles, API client, state, rendering, interactions |

These are the three primary application surfaces, not the entire repository.
Supporting files include `database-config.js`, `setup-database.js`, `electron/`,
`scripts/`, `package.json`, and deployment configuration. Do not move or
describe those supporting files as part of the three-file core.

## 2. Scope (what is IN, what is OUT, what is NEXT)

### 2.1 In Scope — current release

#### Dashboard

- ✅ Shows stock value, retail value, sales, VAT, low-stock, dead-stock, open PO,
  and receivables summary cards.
- ✅ Highlights low stock, dead stock, VAT toggle state, and overdue invoices.
- ✅ Dashboard figures are assembled from browser-held module data; they are
  not all fetched through a dedicated dashboard endpoint.

#### POS

- ✅ Builds a cart from active inventory and submits checkout to `POST /api/sales`.
- ✅ Applies a selected price tier and item tax rates in `sp_complete_sale`.
- ✅ Supports cash-like payment methods and the exact `On Account (B2B)` payment
  string used by the accounting logic.
- ✅ Creates a B2B invoice when the sale is on account and a customer is supplied.
- ✅ Decrements stock through the `sale_lines` insert trigger.
- ✅ Persists sale-time unit cost in `sale_lines.cost_at_sale`.
- 🚧 A complete return/refund workflow is not implemented by the sale creation
  function; `sales.is_return` exists and analytics excludes returned sales in
  some queries, but do not infer a complete return workflow from that column.

#### Inventory

- ✅ Lists items alongside current stock and item master data.
- ✅ Supports creating and editing items through the master-data endpoints.
- ✅ Updates stock for sale lines, GRN lines, and shrinkage through PostgreSQL
  triggers.
- ✅ Uses item reorder points, UOM master data, location, supplier, and tax code.
- 🚧 Multi-location stock balances are not represented: `inventory` has one
  quantity row per SKU and an item-level location.

#### Purchase Orders and GRN

- ✅ Creates POs with supplier, item lines, and an expected date based on
  supplier lead days.
- ✅ Creates a GRN from the PO's lines and updates the PO to `Received`.
- ✅ A GRN line insert updates stock; a statement-level finance trigger posts
  one journal entry for each affected GRN.
- 🚧 The current GRN route receives every line on its PO; partial receiving,
  line-level discrepancy capture, and PO approval are not implemented.

#### Services

- ✅ Records service tickets with customer, date, status, price, and notes.
- ✅ An insert trigger posts positive-price service tickets to the ledger.
- ✅ Service status values are `Pending`, `In_Progress`, `Ready`, `Picked_Up`,
  and `Cancelled`.

#### Rentals

- ✅ Records tool, customer, checkout date, due date, rate, and late fee.
- ✅ An insert trigger posts a rental receivable and revenue entry when the
  computed amount is positive.
- 🚧 The schema stores return date, but no complete return/availability or
  rental inventory lifecycle is present in the current API.

#### B2B / Credit

- ✅ Stores customer type, price tier, credit limit, credit used, and terms.
- ✅ Creates invoices for POS sales paid using `On Account (B2B)`.
- ✅ Lists invoices and supports payment from the Finance AR workflow.
- ✅ Includes customer-credit analytics and an AR aging report.
- 🚧 The sale function increases `credit_used` but does not itself reject a sale
  that would exceed `credit_limit`.

#### Shrinkage

- ✅ Records an incident reason, item, quantity, date, department, value, and
  logging user.
- ✅ Decrements inventory and posts a shrinkage journal entry after insert.
- ✅ Supported reasons: `Theft`, `Damage`, `Miscount`, `Vendor_Short`, `Unknown`.

#### GMROI and Sales Analytics

- ✅ Provides daily, weekly, and monthly analytics ranges.
- ✅ Reports sales totals, cost, gross profit, cash/credit split, and item
  quantities.
- ✅ Reports item sales, customer credit, supplier purchases, and category
  GMROI.
- ✅ The seeded category GMROI view computes gross margin divided by current
  cost-valued inventory for that category; it is not a time-weighted average.

#### Masters

- ✅ Provides 12 tabs: Suppliers, Categories, Items, Customers, UOM, Tax Codes,
  Locations, Price Tiers, Brands, Payment Terms, Number Series, and Users & Roles.
- ✅ Supports create and edit for the listed master data; delete is available
  for resources handled by the generic master mutation helper.
- ✅ Protects many master write routes with `requireMasterEdit`.
- ✅ Stores numbering formats and atomically advances series through
  `fn_next_number`.

#### Users & Roles

- ✅ Provides five seeded roles and a role-permission matrix.
- ✅ Supports user creation, profile/role editing, activation/deactivation,
  and password changes.
- ✅ Stores opaque session tokens only as hashes in PostgreSQL.
- ✅ Revokes sessions when a user is deactivated; password changes invalidate
  other sessions for that user.
- ⚠️ Route-level permission enforcement is uneven across the whole API. The UI
  permission controls are not a replacement for server-side authorization.

#### Finance

- ✅ Provides 15 Finance views: Overview, Chart of Accounts, Journal, Ledger,
  Trial Balance, P&L, Balance Sheet, Cash Flow, Bank & Recon, AR/AP Aging,
  Expenses, VAT Return, Fixed Assets, Budget, and Period Close.
- ✅ Posts manual journals through `fn_post_journal`.
- ✅ Posts POS journals from `sp_complete_sale` and the POS API flow.
- ✅ Posts GRN, service, rental, invoice receipt, expense, shrinkage, asset,
  and depreciation activity through SQL functions/triggers or API transactions.
- ✅ Reports account balances, trial balance, P&L, balance sheet, cash movement,
  aging, VAT totals, budgets, reconciliation status, and period locks.
- 🚧 Cash Flow currently totals direct debits/credits on accounts `1100` and
  `1110`; it is not an indirect-method cash-flow statement.
- 🚧 Finance bootstrap creates an opening journal only if the journal table is
  empty and eligible opening lines are non-zero. There is no force-post flag.

### 2.2 Out of Scope — explicitly excluded (v1)

These items are absent from the current checked-in implementation. The reason
describes the current boundary, not a permanent product decision.

- Multi-currency and FX revaluation — all seeded examples and formatting use LKR.
- Multi-entity consolidation — the schema has no entity dimension.
- Payroll and EPF/ETF filing — no payroll tables or endpoints exist.
- Purchase requisition and PO approval — POs are created directly.
- Partial PO receipts — current GRN creation copies all PO lines.
- Multi-location stock ledger — inventory is one quantity per SKU.
- Full IFRS/GAAP statements with notes — reports are basic aggregates over
  the ledger.
- Immutable audit trail and reversal workflow — entries are not modeled as an
  immutable audit/reversal lifecycle.
- Account-level user authorization — permission rows are role-based.
- Direct IRD filing — the Finance VAT view is a working total, not a filing
  or submission integration.
- Electronic bank feeds — reconciliation is manual.
- Fully supported sales returns and refunds — schema has return fields and
  analytics filtering, but no complete return endpoint/workflow.
- Enforced customer credit limits at checkout — `credit_used` is updated, but
  the sale function does not compare the new balance against the limit.
- Automated test suite — `npm test` is intentionally configured to fail with
  “no test specified”; load test is a separate script.

### 2.3 Backlog — future releases

Priority order below is a suggested engineering sequence based on observed
gaps, not an approved business roadmap. Effort is indicative.

1. **Enforce authorization on every protected business API** — close the gap
   between role-based navigation and server routes; **L**; depends on an
   approved role/permission policy and route inventory.
2. **Add a documented schema migration path** — avoid data loss when evolving
   the database; **L**; depends on migration ownership and deployment procedure.
3. **Complete sales return/refund lifecycle** — preserve inventory, VAT,
   customer-credit, and ledger consistency; **L**; depends on approved return
   policy and accounting treatment.
4. **Support partial receipts and GRN variance** — let receiving record
   quantities actually delivered; **L**; depends on PO status and line-level
   receiving semantics.
5. **Enforce customer credit limits** — prevent unauthorized over-limit
   credit sales; **M**; depends on owner-approved override policy.
6. **Classify cash flow activity** — provide operating/investing/financing
   reporting rather than only cash-account movement; **L**; depends on account
   mapping and accounting review.
7. **Add focused automated tests** — protect SQL accounting and API contracts;
   **M**; depends on a chosen test runner and isolated PostgreSQL test setup.
8. **Add multi-location inventory movements** — represent stock by SKU and
   location; **L**; depends on a migration/backfill and transaction design.
9. **Add supported journal reversal and audit history** — correct posted
   records without erasing traceability; **L**; depends on finance policy and
   period-lock design.

### 2.4 Constraints

- Core application behavior is concentrated in `server.js`, `db.sql`, and
  `index.html`; the repository also has supporting runtime, setup, deployment,
  and desktop files.
- The Node app uses ESM and has no frontend bundler or framework.
- `PG_POOL_MAX` defaults to 1 and must be a positive safe integer. It can be
  configured; one is the documented conservative default, not a fixed
  architectural maximum.
- `pg.Pool` is shared per process via `globalThis[Symbol.for(...)]`.
- Money and financial values use PostgreSQL `NUMERIC(14,2)` where defined;
  quantities generally use `NUMERIC(14,3)`. UOM factors use `NUMERIC(14,4)`.
- Business dates use PostgreSQL `DATE`; audit/session timestamps use
  `TIMESTAMPTZ` and time fields such as `sale_time` use `TIME`.
- LKR is the only currency represented in seeded data and UI formatting.
- The frontend has no build step and expects the API at the configured origin
  or `window.HARDWAREOPS_API`.
- `db.sql` begins by dropping and recreating application tables with `CASCADE`.
  Running it against a database with valuable data destroys that data.
- Finance schema bootstrap is separate from `db.sql` and performs
  `CREATE TABLE IF NOT EXISTS`, alterations, seeds, and trigger/function
  creation. It does not make the destructive base `db.sql` safe to rerun.
- `npm run dist:win` first runs `predist:win` (`node setup-database.js`),
  which interactively creates/selects a company database, applies destructive
  `db.sql`, and updates the repository `.env`; only then does
  `electron-builder --win` package an NSIS installer. Read Section 4.4.1 before
  running it.
- There is no configured unit-test runner. `npm run load-test` is not a
  correctness test suite.
- Database connection values and bootstrap credentials belong in deployment
  environment configuration, never in source-controlled documentation.

### 2.5 Acceptance criteria per module

These are regression checks for the behavior currently implemented. Run them
against an isolated database with representative data; do not use production
for destructive setup.

#### Dashboard

- Sign in and verify summary cards render without a JavaScript error.
- Verify low-stock count uses `qty <= reorder_point` and dead-stock uses the
  current client-side date logic.
- Verify invoice and PO cards reflect the fetched collections after refresh.

#### POS

- Submit a sale and verify the returned sale ID exists in `sales`.
- Verify each inserted sale line decrements its SKU inventory and records
  `cost_at_sale`.
- Verify a normal sale produces a balanced `POS` journal entry.

#### Inventory

- Verify items display current quantity, cost, price, and reorder point.
- Create/edit an item and confirm its master values persist.
- Verify stock changes from sale, GRN, and shrink operations are reflected.

#### Purchase Orders and GRN

- Create a PO with multiple lines and verify supplier and expected date.
- Receive it and verify all PO lines are copied to the GRN and PO becomes
  `Received`.
- Verify stock increments and one balanced GRN journal is produced for the
  complete multi-line receipt.

#### Services

- Create a ticket and verify it appears in the service list with the requested
  status and fields.
- Verify a positive-price ticket creates one `SERVICE` journal referencing
  the ticket.
- Verify a zero-price service does not create a journal.

#### Rentals

- Create a rental with valid dates and positive daily rate.
- Verify positive computed rental value creates a `RENTAL` journal.
- Verify invalid date order, rate, or late fee is rejected.

#### B2B / Credit

- Create an on-account sale for a B2B customer and verify invoice creation.
- Verify the sale increases `customers.credit_used`.
- Receive a partial and then remaining payment through Finance; verify
  `amount_paid`, invoice status, and AR journal activity.

#### Shrinkage

- Create a valid shrink incident and verify stock decreases by its quantity.
- Verify its positive value produces a balanced `SHRINK` journal.
- Verify an invalid reason is rejected by the database constraint.

#### GMROI and Sales Analytics

- Verify date range queries return the expected daily, weekly, or monthly
  period.
- Verify item analytics omit rows from sales marked `is_return`.
- Recompute category gross margin and inventory value from current item and
  stock data and compare the view's GMROI.

#### Masters

- Verify each of the 12 master tabs can load its rows.
- Verify allowed users can create/edit data and disallowed roles are rejected
  by the relevant server-side write guard.
- Verify document creation increments the expected number series.

#### Users & Roles

- Verify correct password login returns a token and incorrect credentials
  return 401.
- Verify inactive users cannot authenticate and deactivation revokes sessions.
- Verify role permissions load from PostgreSQL and protected management
  endpoints reject users without their required permission.

#### Finance

- Verify all 15 Finance tabs load for a role with `finance`.
- Verify the trial balance debit and credit totals match within one cent and
  the balance-sheet equation is checked by the UI.
- Verify an invalid/unbalanced journal is rejected and a valid journal is
  created through `fn_post_journal`.
- Verify period lock blocks entries dated on or before the lock-through date.
- Verify non-finance roles receive 403 from finance endpoints.

## 3. Skills (what you need to know to work here)

### 3.1 Domain Skills

- **Double-entry accounting:** Debits and credits must balance per journal.
  `fn_post_journal` checks minimum line count, non-negative amounts, one-sided
  debit/credit values, and total balance before inserts.
- **VAT and tax codes:** The seeded master has VAT18 (18%, `VAT-STD`), VAT8
  (8%, `VAT-CON`), VAT0 (0%, `VAT-EXM`), and NONE (0%). POS tax is computed
  from configured rates when tax is enabled. Confirm current Sri Lankan tax
  law and filing rules with a qualified owner/accountant before changing rates
  or reporting.
- **IRD codes:** `tax_codes.ird` stores a text code from the master. It is
  metadata; no IRD submission API is implemented.
- **Depreciation:** The Finance endpoint accepts `YYYY-MM` periods, computes
  monthly depreciation for active assets, records accumulated depreciation,
  and posts through the general journal path. The current journal date is the
  first day of that month (`YYYY-MM-01`), not the 28th. Review the
  implementation and accounting policy before changing its method or account
  mappings.
- **AR/AP aging:** AR uses invoice due dates; AP uses GRN receive dates. Aging
  reports use current date and buckets Current, 1–30, 31–60, 61–90, and 90+.
- **GMROI:** `v_gmroi_category` calculates gross margin divided by current
  cost-valued inventory for each category. It is not a full-period retail
  inventory accounting calculation.
- **UOM conversion:** UOM records include base UOM, conversion factor, and
  display decimals. Inventory quantity is stored to three decimal places;
  conversions must preserve the base-unit meaning.
- **Price tiers:** `price_tiers.disc` is the discount percentage applied by
  `sp_complete_sale`; `applies_to` is stored metadata and should not be assumed
  to be enforced by that function.
- **Credit limits:** Customer records store `credit_limit` and `credit_used`.
  On-account sale creation updates usage but does not enforce the limit in the
  SQL function; do not promise over-limit prevention without implementing it.
- **Inventory costing:** Sale lines snapshot item cost into `cost_at_sale`.
  GRN and shrink postings use stored quantities/cost or incident value; avoid
  replacing these historical values with today's item cost.

### 3.2 Technical Skills — Backend

- **PostgreSQL:** Understand foreign keys, numeric precision, check/unique
  constraints, views, PL/pgSQL functions, row and statement triggers, and
  transaction boundaries.
- **Advisory locks:** Journal posting serializes around lock key `7319422`;
  several source operations also use keyed transaction locks to avoid
  duplicate posting. Acquire locks inside a transaction when the operation
  requires transaction-scoped coordination.
- **Express:** Routes are registered directly on `app`. Use existing auth and
  permission middleware, parameterized SQL, and `wrap()` for consistent error
  handling. Keep route response behavior compatible with existing consumers.
- **Node ESM:** `server.js` imports modules and exports `app`,
  `startServer`, `stopServer`, and schema initializers.
- **`pg.Pool`:** The default max of one means concurrent requests queue for the
  same process pool. Avoid holding a checked-out client while waiting on
  unrelated network work. Explicitly release clients in `finally`.
- **Password/session security:** Passwords use Node `scrypt` with a random
  salt and timing-safe comparison. Session tokens are random opaque bearer
  values; only SHA-256 hashes are persisted.
- **Schema bootstrap:** Auth and Finance initialization memoize promises on
  `globalThis` using `Symbol.for`. Finance initialization deletes its memoized
  promise on failure so a later request can retry.
- **Busy database response:** PostgreSQL connection exhaustion code `53300`
  becomes `{ "error": "database_busy" }` with `Retry-After: 2`. The browser
  retries GETs up to two times; it does not automatically retry mutations.
- **SQL safety:** Bind user data as query parameters; do not interpolate
  request values into SQL. Dynamic master table names must remain allow-listed.

### 3.3 Technical Skills — Frontend

- **Vanilla SPA:** Panels, tabs, state, templates, listeners, and API
  interactions are all in `index.html`; there is no framework or bundler.
- **API helper:** `api(path, opts)` attaches the bearer token and retries GET
  requests after `database_busy`; writes are not retried automatically.
- **Rendering helpers:** `$()` retrieves an element by ID, `table()` creates
  tabular HTML from cell arrays, and `money()` formats LKR values.
- **Permissions:** `can(permission)` checks the current role's loaded
  permission data; `applyPermissions()` disables navigation and master tabs.
  UI gating is usability, not a security boundary.
- **Finance rendering:** `renderFinance()` dispatches to
  `renderFinanceView(view)`, and Finance views fetch server data through `api`.
- **Other panels:** The frontend keeps module data in global arrays and many
  renderers operate on those arrays. Do not assume every `render*()` function
  independently fetches fresh data.
- **DOM safety:** Finance output uses `finEsc` for dynamic string values.
  Preserve equivalent escaping when interpolating user-controlled values into
  HTML; `table()` itself does not escape cells.
- **Notifications:** `toast(message, kind)` displays transient messages.
  Preserve established form and status feedback patterns.

### 3.4 Integration Skills

- **Document IDs:** Use PostgreSQL `fn_next_number(code)` and an existing or
  deliberately seeded `number_series` row for numbered documents. The call
  consumes a sequence value and is not idempotent.
- **General ledger:** Route every new GL posting through
  `fn_post_journal(entry_date, description, source, ref, lines, created_by)`.
  Never insert journal headers or lines directly from the frontend.
- **Stock updates:** Existing triggers adjust stock on inserts to `sale_lines`,
  `grn_lines`, and `shrink_incidents`. Avoid duplicating those adjustments in
  an API handler.
- **Finance trigger design:** Use the existing naming style (`trg_*`) and
  coordinate source-event posting with existing uniqueness/idempotency guards.
  The current system is mixed: POS explicitly calls posting logic; GRN,
  shrinkage, services, rentals, invoice receipts, and expenses use database
  trigger paths.
- **Views:** Analytics views use `v_*`; current Finance reports mostly query
  tables directly rather than `v_fin_*` views. Use `v_fin_*` only as a
  deliberate new convention, not as a claim about existing objects.
- **Renderer dispatch:** Add a Finance view to the `data-fin-view` markup,
  `renderFinanceView` switch, associated API interaction, and form/click
  dispatch wiring.
- **Schema bootstrapping:** When changing Finance DDL, inspect both `db.sql`
  and `initializeFinanceSchema()` in `server.js`; they contain overlapping
  definitions and can drift.
- **Permissions:** A new permission needs coordinated UI key/matrix wiring,
  role seed/bootstrap rows, and server-side enforcement on each affected
  endpoint.

### 3.5 Anti-Patterns (things NOT to do here)

1. **Do not add a second application process for a feature.** The current API
   and deployment assumptions use one Express app.
2. **Do not introduce a frontend framework or bundler without an approved
   architectural decision.** The UI is deliberately a single HTML/JS file.
3. **Do not use floating-point database types for money.** Use `NUMERIC` with
   deliberate scale and rounding.
4. **Do not compute or submit journal lines from the browser.** Accounting
   must be validated and persisted server-side.
5. **Do not insert directly into `journal_entries` or `journal_lines`.** This
   bypasses balance and period-lock checks in `fn_post_journal`.
6. **Do not call `fn_next_number` expecting a safe retry.** Each call advances
   the counter, including calls whose later operation may fail.
7. **Do not rerun `db.sql` on a database containing data.** Its initial
   `DROP TABLE ... CASCADE` statements are destructive.
8. **Do not add a stock adjustment in both application code and an existing
   stock trigger.** That double-counts inventory movements.
9. **Do not assume `applies_to` enforces a price-tier/customer-type match.**
   Validate explicitly where the business requires it.
10. **Do not assume a customer credit limit is enforced at checkout.** It is
    stored but not currently checked in `sp_complete_sale`.
11. **Do not treat the Finance UI's disabled navigation as API authorization.**
    Each protected write and read needs a server-side guard.
12. **Do not change account codes casually.** Codes such as `1100`, `1200`,
    `1300`, `1400`, `2100`, `2200`, `2210`, `4100`, and `6600` are referenced
    in posting/report SQL.
13. **Do not add recursive triggers or trigger work that mutates the same
    triggering rows without a recursion plan.** Trigger chains can re-enter or
    produce duplicate effects.
14. **Do not hold a pool client while performing external or slow work.**
    With pool max 1, one stalled transaction can block the whole process.
15. **Do not retry financial mutations automatically after an ambiguous
    timeout.** Confirm whether the transaction committed before resubmitting.
16. **Do not trust client-supplied user IDs for attribution.** Prefer the
    authenticated `req.user.id` where the route has authenticated context.
17. **Do not change date semantics implicitly.** Posting dates are business
    dates; `CURRENT_DATE` is not interchangeable with a source document date.
18. **Do not claim that a report is a statutory filing or indirect cash-flow
    statement unless its implementation and review support that claim.**
19. **Do not insert unescaped user-provided strings into HTML.** `table()` is
    not an escaping template engine.
20. **Do not assume new DDL belongs in only one of the two schema paths.**
    Keep base SQL and Finance bootstrap compatible, or document the intended
    deployment path explicitly.

## 4. Memory (the institutional memory of this project)

### 4.1 Architecture Decision Record (ADR) — condensed

The following records describe current implementation decisions and
constraints. They are condensed references, not a claim that separate ADR
documents exist.

- **ADR-001: Concentrated core application files**
  - **Context:** Feature behavior must remain approachable in a small app.
  - **Decision:** Keep API, schema/seed, and browser UI primarily in
    `server.js`, `db.sql`, and `index.html`.
  - **Consequences:** Easy to locate core behavior; files are large and
    require disciplined section boundaries.
  - **Alternatives Rejected:** Per-module router/UI files are not the current
    pattern; supporting infrastructure files already exist outside the core.

- **ADR-002: Server-rendered data, vanilla-JS client**
  - **Context:** The app needs a browser UI without a compilation pipeline.
  - **Decision:** Use static HTML/CSS and JavaScript that requests JSON from
    Express and renders the results.
  - **Consequences:** No build tooling; client state and HTML escaping remain
    hand-maintained.
  - **Alternatives Rejected:** A framework and client-side bundle are not
    currently used.

- **ADR-003: Database-owned stock effects**
  - **Context:** Sales, receipts, and shrinkage must affect stock consistently.
  - **Decision:** Insert triggers adjust inventory for sale lines, GRN lines,
    and shrink incidents.
  - **Consequences:** API writes inherit stock effects; callers must account
    for trigger timing and avoid duplicate updates.
  - **Alternatives Rejected:** Duplicating stock arithmetic in each route.

- **ADR-004: Mixed SQL and trigger accounting integration**
  - **Context:** Business events need ledger entries close to their source.
  - **Decision:** Use `fn_post_journal` as the common posting validator, with
    event-specific SQL functions/triggers and explicit POS calls.
  - **Consequences:** Posting behavior is distributed between the POS stored
    function, Express transactions, and PostgreSQL triggers.
  - **Alternatives Rejected:** A single application-side posting implementation
    is not how the current code is structured.

- **ADR-005: Promise memoization for schema initialization**
  - **Context:** Multiple requests or serverless invocations can encounter
    schema setup concurrently.
  - **Decision:** Memoize pool/auth/Finance initialization state on
    `globalThis` using `Symbol.for` keys.
  - **Consequences:** Work is shared within a process; failed Finance
    initialization clears its memo so a later call can retry.
  - **Alternatives Rejected:** Re-running all DDL independently for every
    request.

- **ADR-006: scrypt password hashes**
  - **Context:** Passwords must not be stored in plaintext.
  - **Decision:** Hash with Node's `scrypt`, random 16-byte salt, and 64-byte
    derived key; compare with `timingSafeEqual`.
  - **Consequences:** Hash format is `scrypt$<salt_hex>$<hash_hex>` and needs
    compatible verification.
  - **Alternatives Rejected:** bcrypt is not in the current dependencies or
    implementation.

- **ADR-007: Opaque bearer sessions instead of JWT**
  - **Context:** The server needs revocable, expiring login sessions.
  - **Decision:** Issue random bearer tokens, persist only SHA-256 token hashes
    in `auth_sessions`, and expire sessions after 12 hours.
  - **Consequences:** Each authenticated request looks up session state in
    PostgreSQL; logout/deactivation can revoke access.
  - **Alternatives Rejected:** Stateless JWT validation is not used.

- **ADR-008: Conservative pool default**
  - **Context:** The target database may have a limited connection allowance.
  - **Decision:** Default `PG_POOL_MAX` to 1 while allowing a validated
    positive override.
  - **Consequences:** Requests serialize under default configuration and
    pool exhaustion is surfaced as a retryable 503.
  - **Alternatives Rejected:** An unbounded or hard-coded larger pool.

- **ADR-009: Opening balance initialization**
  - **Context:** A new Finance ledger needs an opening position from existing
    operational balances.
  - **Decision:** When no journal exists, Finance bootstrap derives inventory,
    receivables, payables, fixed assets, and accumulated depreciation and posts
    an `OPENING` journal dated one day before the earliest selected transaction
    date (or yesterday when none exists).
  - **Consequences:** Bootstrap is data-dependent and runs through the ordinary
    period-lock and balance validation path. There is no force flag or
    `OPENING` exemption in `fn_post_journal`.
  - **Alternatives Rejected:** A separate bypass of journal validation is not
    implemented.

- **ADR-010: Multi-line GRN single journal**
  - **Context:** A GRN may contain multiple inserted receipt lines.
  - **Decision:** A statement-level transition-table trigger gathers distinct
    GRN IDs and posts once per GRN.
  - **Consequences:** The journal represents the entire GRN's lines; a later
    separate insert for the same GRN relies on source/ref lookup to avoid
    another posting and does not update that existing journal.
  - **Alternatives Rejected:** One journal per GRN line.

- **ADR-011: Direct cash-account movement report**
  - **Context:** Finance needs a cash movement view.
  - **Decision:** The current endpoint sums debits and credits on accounts
    `1100` and `1110` for a date range.
  - **Consequences:** It is a direct cash movement summary, not an indirect
    statement classified by operating, investing, and financing activity.
  - **Alternatives Rejected:** Indirect-method calculation is not implemented.

- **ADR-012: Period lock-through date**
  - **Context:** Backdated journals must not modify closed periods.
  - **Decision:** `fn_post_journal` rejects an entry when any
    `lock_through_date >= p_entry_date`, using transaction advisory lock
    `7319422` around the check and insert path.
  - **Consequences:** A journal dated on the lock-through date is blocked.
    The current check uses `EXISTS`, not a `MAX()` query.
  - **Alternatives Rejected:** A `MAX(lock_through_date)` calculation is not
    required by the current implementation.

- **ADR-013: Finance permission keys**
  - **Context:** Finance screens and mutations require role gating.
  - **Decision:** Use `finance` for viewing and `finance_edit` for changes.
  - **Consequences:** Server-side finance middleware checks PostgreSQL role
    grants. Current bootstrap grants `finance_edit` to Accountant as well as
    Owner and Manager, despite the seeded Accountant description saying
    “Read-only financials.”
  - **Alternatives Rejected:** Treating the role description as authoritative
    over actual grants.

- **ADR-014: Destructive base schema script**
  - **Context:** The SQL file represents a clean base schema and demo seed.
  - **Decision:** `db.sql` drops application tables with `CASCADE`, then
    creates them.
  - **Consequences:** It is suitable only for a fresh/disposable database or
    deliberate reset after backup.
  - **Alternatives Rejected:** Safe in-place migration behavior is not provided
    by `db.sql`.

### 4.2 Conventions Cheat-Sheet

| Area | Current convention |
|---|---|
| Tables | Lowercase `snake_case`, generally plural |
| Views | `v_*`; current views: `v_item_sales`, `v_customer_credit`, `v_supplier_purchases`, `v_gmroi_category` |
| Trigger functions | Existing names commonly begin `trg_*`; names do not all follow a Finance-only prefix |
| Triggers | `trg_*`; use explicit row/statement timing and event |
| Functions | `fn_*`; `sp_complete_sale` is a PL/pgSQL function despite its `sp_` prefix |
| Indexes | `idx_*`; unique constraints/indexes include names such as `uq_bank_reconciliations_line` |
| Constraints | Inline `PRIMARY KEY`, `REFERENCES`, `CHECK`, and `UNIQUE` are used; names are not consistently explicit |
| Money | Usually `NUMERIC(14,2)` |
| Quantity | Usually `NUMERIC(14,3)` |
| UOM conversion | `NUMERIC(14,4)` |
| Dates | Business dates generally `DATE`; timestamps include `created_at`, `updated_at`, and session expiry |
| JSON API | Many collection endpoints return arrays; creates often return `{ "id": ... }`; errors generally return `{ "error": ... }`; some operations return `{ "ok": true, ... }` |
| HTTP status | Uses 200, 201, 400, 401, 403, 404, 409, 422, 500, and 503 depending on endpoint/error path |
| Database busy | PostgreSQL `53300` returns `503`, `{ "error": "database_busy" }`, and `Retry-After: 2` |
| Frontend panel | Navigation buttons use `data-panel`; Finance tabs use `data-fin-view`; master tabs use `data-master` |
| Frontend helpers | `$`, `api`, `toast`, `money`, `table`, `can`, `applyPermissions` |
| Finance rendering | `renderFinance()` delegates to `renderFinanceView(view)` and uses finance API endpoints |
| Financial rendering | Finance report values are fetched from the API; do not replace reports with client-side accounting calculations |

Do not assume every route uses every status code or one uniform response shape.
Inspect the route and preserve its existing contract.

### 4.3 Known Gotchas (G-series, numbered)

- **G-001 — Pool exhaustion is retryable but not idempotent.** Code `53300`
  produces a 503. The browser retries GET requests twice, but mutation requests
  are not retried.
- **G-002 — `fn_next_number` consumes a number.** A failed later insert can
  leave a gap; do not retry the whole operation blindly.
- **G-003 — Trigger effects are part of the transaction.** An API insert can
  alter inventory or post a journal even when the route does not show those
  effects explicitly.
- **G-004 — Trigger recursion and duplicate writes are possible design risks.**
  A trigger that writes to its own triggering table or duplicates app-level
  logic can cause recursion or double effects.
- **G-005 — Opening journals have no force flag.** The bootstrap's opening
  journal calls the ordinary `fn_post_journal`; locks and balancing still apply.
- **G-006 — GRN accounting is statement-triggered.** It groups inserted lines
  by GRN, so it posts one journal per GRN per statement, not per line.
- **G-007 — Later GRN line inserts do not amend an existing journal.** The
  source/ref lookup returns the existing journal ID; it does not recalculate
  the original lines.
- **G-008 — Return flags do not constitute a return workflow.** `is_return`
  exists, but POS checkout does not implement return sign reversals or refunds.
- **G-009 — Source business date is the accounting date.** POS uses `sale_date`;
  GRN uses `date_received`; services use `date_in`; rentals use `date_out`.
  Payment journal paths currently use `CURRENT_DATE`.
- **G-010 — Period locks include the boundary date.** `lock_through_date >=
  p_entry_date` blocks entries dated on the lock-through date or earlier.
- **G-011 — Period lock uses a fixed advisory key.** The journal posting
  function and lock route must preserve serialization if this design changes.
- **G-012 — Depreciation period input is `YYYY-MM`.** The manual API validates
  this format and posts the journal dated `YYYY-MM-01`. Older planning notes
  mention the 28th; that is not the current source behavior.
- **G-013 — VAT treatment differs by source workflow.** POS computes tax on
  its discounted line base; GRN finance adds tax calculated from line cost and
  the item's tax code. Do not assume one universal inclusive/exclusive-price
  convention.
- **G-014 — COA codes are embedded in SQL.** Renaming or renumbering accounts
  requires updating posting functions, reports, seeds, and existing journal
  data coherently.
- **G-015 — Currency rounding is significant.** Use numeric arithmetic and
  the code's explicit two-decimal rounding; avoid JavaScript binary floating
  point as the source of accounting truth.
- **G-016 — UI permission hiding is insufficient.** Some APIs enforce
  permission middleware, while numerous operational endpoints only require
  authentication. Audit the server route before treating a permission as
  enforced.
- **G-017 — Finance permission bootstrap may not repair existing grants.**
  Rows are inserted with `ON CONFLICT DO NOTHING`; changing seed defaults does
  not update an already-existing row.
- **G-018 — `db.sql` is a reset script, not an idempotent migration.** It drops
  tables and cascades dependencies before creating the schema.
- **G-019 — Finance schema is duplicated.** Core Finance DDL and seeds occur
  in `db.sql` and `initializeFinanceSchema()`; changing one without the other
  creates different fresh-install and runtime-bootstrap behavior.
- **G-020 — Some documentation is aspirational.** For example, cash flow is
  direct cash-account movement, not indirect method; use source behavior as
  truth.
- **G-021 — `table()` does not escape cell strings.** Escape dynamic content
  before including it in generated HTML.
- **G-022 — Pool size is per process/instance.** A value of one is not a
  fleet-wide database connection cap when multiple serverless instances run.
- **G-023 — Route permission enforcement is not uniform.** Finance routes
  check Finance permissions; master writes, user management, and several
  other routes use their own guards; do not infer a blanket policy.
- **G-024 — Verify compatibility before merge.** Check API consumers, schema
  bootstrap and base SQL, role grants, document IDs, trigger side effects,
  date/rounding behavior, and deployment constraints.

### 4.4 File Touch List

#### `server.js`

- Owns Express setup, middleware, request context, pool creation, auth,
  permissions, API route behavior, Finance schema bootstrap, and server
  lifecycle.
- A typical API change adds a route near the matching module, parameterizes
  SQL, uses `wrap()` for handled errors, checks authenticated permissions, and
  preserves the established JSON contract.
- A Finance schema change must be checked against the embedded
  `initializeFinanceSchema()` DDL and seed.

#### `db.sql`

- Owns the resettable base schema, seeded roles/permissions/users/masters,
  inventory triggers, Finance schema and posting logic, analytics views, and
  POS stored function.
- A typical schema or posting change updates the DDL, constraints, seed,
  relevant triggers/functions, and verification queries together.
- **Warning:** this script drops existing tables with `CASCADE`.

#### `index.html`

- Owns all browser markup, styles, panel/tab navigation, API helper, global
  state, view renderers, form submission, and UI permission gating.
- A typical feature change updates markup, any styles, the renderer, and
  delegated click/change/submit handlers. Escape dynamic text before HTML
  interpolation.

The current feature-code convention is to keep application behavior in these
three core files. The repository already has supporting files. Do not add
another application module file without an approved architectural decision;
propose a split with an ADR rather than silently expanding the feature
architecture.

#### 4.4.1 Electron desktop and `npm run dist:win`

The desktop wrapper is implemented in `electron/main.js` and
`electron/preload.cjs`. The main process loads database configuration, starts
the existing Express API on an available `127.0.0.1` port, and opens
`index.html` in a sandboxed Electron window. The preload exposes that local API
URL as `window.HARDWAREOPS_API`; closing the desktop app shuts down its API
server. PostgreSQL must be reachable from the machine running the app.

Running:

```sh
npm run dist:win
```

performs these steps, in order:

1. npm runs the `predist:win` lifecycle script from `package.json`:
   `node setup-database.js`.
2. The setup script prompts for a company name and database target (`local` by
   default). It normalizes the company name to a PostgreSQL database name.
3. For `local`, it ensures the PostgreSQL service is running, locates `psql`
   (and attempts a silent PostgreSQL 16 `winget` install if `psql` is missing),
   then prompts for the local PostgreSQL superuser password (default:
   `postgres`). It creates the company database when absent.
4. For `aiven`, it requires a valid `DATABASE_URL_AIVEN` in the repository
   `.env` and targets the configured Aiven host/port with SSL required.
5. If the company database already exists, setup asks before applying the
   schema. On confirmation it runs `db.sql`, whose `DROP TABLE ... CASCADE`
   statements delete/recreate application tables and their data.
6. Setup writes the chosen target and company database URL into the repository
   `.env`, preserving unrelated lines and comments.
7. If setup succeeds, npm runs `electron-builder --win`. The `win` build
   configuration targets an NSIS Windows installer for **HardwareOps
   Optimizer**. The default electron-builder output directory is `dist/`.

The command is interactive and has side effects before packaging. Use a
disposable/new company database, or confirm that replacing all application
tables in the selected existing database is intended. Do not point this step
at production or valuable data unless a verified backup and explicit
replacement approval exist. A setup cancellation/error prevents the packaging
step from running.

The Electron build configuration explicitly copies the project-root `.env`
into packaged resources via `extraResources`. That file can contain database
credentials; anyone with the installer or installed resources can extract
them. Distribute the resulting installer only to trusted users, never commit
real credentials, and rotate credentials if the installer is exposed. The
database settings selected during build are embedded in the installer and
take precedence at runtime; the app-user `.env` may override non-database
settings. Windows runtime settings can be placed in
`%APPDATA%/hardwareops/.env`, subject to that precedence.

Typical prerequisites are Node/npm dependencies, a Windows build environment,
PostgreSQL client/service access for the setup step, and either valid local
PostgreSQL credentials or configured Aiven credentials. Keep local/Aiven
selection deliberate: the selected database is initialized before the
installer is produced.

### 4.5 Verification Script

Run only against the intended database. Set `DATABASE_URL` to a safe
development database; never paste credentials into source control or a shared
terminal transcript.

```bash
set -eu

: "${DATABASE_URL:?Set DATABASE_URL to a development PostgreSQL URL}"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF EXISTS (
    SELECT je.id
    FROM journal_entries je
    LEFT JOIN journal_lines jl ON jl.je_id = je.id
    GROUP BY je.id
    HAVING COUNT(jl.id) < 2
       OR ABS(COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0)) > 0.009
  ) THEN
    RAISE EXCEPTION 'Unbalanced or incomplete journal entry found';
  END IF;

  IF EXISTS (
    SELECT source, ref
    FROM journal_entries
    WHERE ref IS NOT NULL
    GROUP BY source, ref
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate journal source/ref pair found';
  END IF;

  IF EXISTS (
    SELECT required.role_key, required.perm_key
    FROM (VALUES
      ('Owner'), ('Manager'), ('Cashier'), ('Storekeeper'), ('Accountant')
    ) AS roles(role_key)
    CROSS JOIN (VALUES
      ('dashboard'), ('pos'), ('inventory'), ('po'), ('grn'), ('services'),
      ('rentals'), ('b2b'), ('shrink'), ('gmroi'), ('analytics'), ('masters'),
      ('masters_edit'), ('numberseries'), ('users_manage'), ('finance'),
      ('finance_edit')
    ) AS permissions(perm_key)
    CROSS JOIN LATERAL (
      SELECT roles.role_key, permissions.perm_key
    ) AS required
    LEFT JOIN role_permissions rp
      ON rp.role_key = required.role_key AND rp.perm_key = required.perm_key
    WHERE rp.role_key IS NULL
  ) THEN
    RAISE EXCEPTION 'A required role permission row is missing';
  END IF;

  IF ABS(
    COALESCE((SELECT SUM(debit) FROM journal_lines), 0)
    - COALESCE((SELECT SUM(credit) FROM journal_lines), 0)
  ) > 0.009 THEN
    RAISE EXCEPTION 'Ledger-wide trial balance does not balance';
  END IF;
END $$;

SELECT 'journal and permission checks passed' AS result;
SQL
```

Finance API smoke test (use a development API and credentials supplied
through environment variables):

```bash
set -eu
: "${API_BASE:=http://localhost:4000}"
: "${LOGIN_EMAIL:?Set LOGIN_EMAIL}"
: "${LOGIN_PASSWORD:?Set LOGIN_PASSWORD}"

TOKEN="$(
  curl --fail --silent --show-error \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"${LOGIN_EMAIL}\",\"password\":\"${LOGIN_PASSWORD}\"}" \
    "${API_BASE}/api/login" |
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).token))'
)"

curl --fail --silent --show-error \
  -H "Authorization: Bearer ${TOKEN}" \
  "${API_BASE}/api/finance/trial-balance"
printf '\n'
```

The database checks intentionally fail when source/ref duplicates exist; the
schema does not currently declare a unique constraint for that pair. Review
duplicates before remediation instead of deleting accounting records blindly.

## 5. Brain (the operating manual for change requests)

### 5.1 Change Request Intake Checklist

Before writing code, answer:

1. Which module or modules does this touch?
2. Does it require a schema change? If yes, follow 5.3.
3. Does it require a permission change? If yes, follow 5.4 and inspect every
   affected API route.
4. Does it create journal entries? If yes, use `fn_post_journal`; never write
   GL rows directly.
5. Does it add a document type? If yes, define a `number_series` row and use
   `fn_next_number`.
6. Does it change an existing API, schema, permission, or accounting contract?
7. What is the data migration and rollback plan?
8. Does an existing trigger already produce the required stock or finance
   side effect?
9. What is the exact acceptance test, including role and date boundary cases?
10. Which of `db.sql` and `initializeFinanceSchema()` must change?

Decision path:

```text
Request
  ├─ Presentation only, no API/data behavior? → Cosmetic review (5.2)
  ├─ API or domain behavior? → Behavioral review (5.2)
  ├─ Table, column, index, seed, or migration? → Schema procedure (5.3)
  ├─ Role, permission, credential, or session? → Permission/security review (5.4)
  └─ Money, tax, credit, journal, or account mapping? → Financial procedure (5.5)
       └─ If more than one branch applies, complete all applicable checklists.
```

### 5.2 Change Classification

#### 🔧 Cosmetic — no data, API, or schema

- Confirm panel navigation and responsive layout remain intact.
- Verify keyboard and form behavior for the touched controls.
- Preserve escaping and accessible labels.
- No schema migration is required.

#### ⚙️ Behavioural — API or business logic

- Identify current and changed request/response shapes.
- Verify success, invalid input, not-found, conflict, and database-busy paths.
- Verify transactions and trigger side effects.
- Test at least one allowed and one disallowed role when access is relevant.
- Confirm existing callers remain compatible.

#### 🗄️ Structural — schema or migration

- Follow 5.3 and take/verify a database backup before deployment.
- Make runtime bootstrap and clean-database schema behavior compatible.
- Define backfill, lock, rollback, and deployment ordering.
- Do not use the destructive base reset script as an in-place migration.

#### 🔐 Security — auth, permissions, or passwords

- Follow 5.4; enforce access on the server, not only in the UI.
- Verify no secret is logged or returned and compare passwords safely.
- Check session issuance, expiration, invalidation, and deactivation behavior.
- Test both allowed and denied requests directly against the API.
- Request a focused security review for security-sensitive changes.

#### 💰 Financial — GL, VAT, pricing, or credit

- Follow 5.5 and record an ADR.
- Confirm debit/credit signs, account codes, business date, VAT basis, and
  rounding against an accountant-approved example.
- Verify period lock behavior and idempotency under retry.
- Check both the journal-level and ledger-wide balance queries.
- Obtain Owner sign-off before release.

### 5.3 Schema Change Procedure

1. Describe the new/changed table, columns, constraints, indexes, and data
   semantics.
2. Add an idempotent migration or bootstrap change. Do not put a production
   migration behind `DROP TABLE`.
3. Update both `db.sql` and `initializeFinanceSchema()` when the change
   touches Finance objects that are created by both paths.
4. If data is renamed, backfilled, or account/document codes change, write an
   ordered migration with a verified rollback or restore plan.
5. Update dependent functions, triggers, views, and API queries.
6. Update the relevant frontend forms/renderers and permission controls.
7. Update this document's schema, conventions, gotchas, inventory, and
   acceptance criteria as applicable.
8. Run the verification script in 4.5 against an isolated database and test
   both a clean install and an existing-schema upgrade.
9. Document deployment order and backup requirements in the change request.

### 5.4 Permission Change Procedure

1. Define the permission key and its exact read/write meaning.
2. Add it to `PERMISSION_KEYS` and the relevant UI permission wiring.
3. Add the role grant rows to `db.sql` and the Finance bootstrap if applicable.
   Use a deliberate upsert/update strategy; current `ON CONFLICT DO NOTHING`
   does not revise existing grants.
4. Add or reuse server middleware and attach it to every protected endpoint.
5. Keep UI gating for usability, but treat API authorization as mandatory.
6. Test each role directly against API endpoints; verify both expected 200 and
   expected 403 results.
7. Verify navigation, hidden/disabled actions, and permission editor behavior.
8. Update the permission matrix in Appendix 8.3.

### 5.5 Financial Change Procedure

Any change touching money, VAT, ledger accounts, pricing, credit, depreciation,
or reporting must:

1. Record an ADR before implementation.
2. Obtain a concrete example approved by the Owner or accountant, including
   dates, amounts, signs, account codes, and tax treatment.
3. Post entries only through `fn_post_journal`.
4. Test the change in an isolated database with a controlled journal entry.
5. Verify journal balance, ledger-wide trial balance, P&L/balance-sheet
   effects, and period-lock behavior.
6. Test duplicate requests, transaction rollback, and ambiguous retry behavior.
7. Update this document's ADR, gotchas, schema, and API inventory.
8. Obtain Owner sign-off before merge/deployment.

### 5.6 Definition of Done

- [ ] Core feature code follows the approved three-file application pattern.
- [ ] Supporting-file changes are necessary and documented.
- [ ] New endpoints preserve authentication, permission, error, and response conventions.
- [ ] New permission checks exist on the server, not only in the UI.
- [ ] New document IDs use `fn_next_number` and a valid series row.
- [ ] New GL entries go through `fn_post_journal`.
- [ ] Existing stock and Finance triggers are accounted for without duplicate effects.
- [ ] `db.sql` and runtime Finance bootstrap are compatible.
- [ ] Verification script in 4.5 passes against an isolated database.
- [ ] Focused functional tests cover the changed behavior.
- [ ] ADR, known gotchas, API/schema inventory, and acceptance criteria are updated.
- [ ] Breaking changes include a migration and rollback plan.
- [ ] Financial changes have Owner/accountant sign-off recorded.
- [ ] No credentials, production data, or secret configuration are committed.

### 5.7 Adding a New Module

Use Finance as an integration example, not as evidence that every Finance
design decision is complete.

1. **Define module contract**
   - List user roles, workflows, API shapes, dates, money/quantity semantics,
     success/error states, and acceptance criteria.
   - Identify existing endpoints, triggers, and data that must remain compatible.
2. **Schema**
   - Define tables, columns, constraints, indexes, seed data, and ownership.
   - Add document type to `number_series` if the module creates numbered
     documents.
   - Add permission rows and any reporting views.
   - Coordinate `db.sql` and runtime schema bootstrap.
3. **Server**
   - Add schema bootstrap only if the module needs runtime initialization.
   - Add parameterized SQL routes and transaction boundaries.
   - Add explicit auth and permission guards to every route.
   - Route any GL effects through `fn_post_journal`.
   - Return defined status and response shapes; handle `53300`.
4. **Frontend**
   - Add navigation and a panel using the existing `data-panel` pattern.
   - Add sub-tabs with `data-*` attributes as appropriate.
   - Add the renderer and wire it into the current dispatcher/lifecycle.
   - Add forms and delegated submit/click handling.
   - Extend permission keys, matrix, `applyPermissions()`, and server guards.
   - Escape untrusted strings before HTML interpolation.
5. **Verification**
   - Add module acceptance criteria with allowed/denied role cases.
   - Test fresh setup and upgraded schema in a disposable database.
   - Verify number series, trigger side effects, and balanced journals where
     applicable.
6. **Documentation**
   - Update Sections 1–5 and 8 of this document.
   - Add a concrete change request entry in Section 6 while work is active.
   - Remove or mark shipped backlog entries after release.

## 6. Requested Changes (living backlog)

Every new request enters this section before implementation. Entries below
are proposed examples derived from current implementation gaps; they are not
approved commitments.

### CR-001: Enforce server-side permissions across business APIs

**Status:** Proposed
**Class:** 🔐
**Module(s):** API / Users & Roles
**Requested by:** Project maintainers
**Date:** 2026-10-20
**Why:** Navigation permission checks do not secure API endpoints. A
consistent server-side authorization policy is required before role-specific
access can be relied upon.
**What:**

- Define read and write permissions for all operational endpoints.
- Apply server-side checks to each route and verify denied requests return 403.
- Align role descriptions, seeded grants, and UI behavior.

**Touches:**

- Files: `server.js`, `db.sql`, `index.html`
- Schema: no new tables; `role_permissions` rows may change
- Permissions: existing keys and any explicitly approved new keys
- Financial impact: no direct posting change

**Acceptance criteria:**

- [ ] Every protected route has an explicit server-side permission policy.
- [ ] Automated or repeatable direct API checks cover each role.

**Verification steps:**

- [ ] Request each protected route as allowed and denied roles.
- [ ] Confirm navigation is consistent with API access.
- [ ] Run backwards-compatibility checklist.

**Rollback plan:** Revert the permission middleware/grant change and restore
the previous tested role matrix.

**Notes / decisions:** ADR-013; security review required before release.

### CR-002: Add partial PO receiving and GRN variance

**Status:** Proposed
**Class:** ⚙️
**Module(s):** Purchase Orders / GRN / Inventory / Finance
**Requested by:** Project maintainers
**Date:** 2026-10-20
**Why:** Current GRN creation copies every PO line. A receiving workflow needs
to record actual delivered quantities while keeping PO balances and stock
accurate.
**What:**

- Record received quantity by PO line.
- Keep PO state open/partial until all remaining quantities are resolved.
- Post stock and one balanced receipt journal for the actual GRN.

**Touches:**

- Files: `server.js`, `db.sql`, `index.html`
- Schema: likely PO-line receipt tracking and GRN line references; design pending
- Permissions: receiving permissions must be confirmed
- Financial impact: yes; inventory, VAT receivable, and payables

**Acceptance criteria:**

- [ ] A partial receipt changes stock and AP only by the received quantity.
- [ ] Remaining PO quantity remains receivable.
- [ ] Multiple GRNs cannot double-receive the same quantity.

**Verification steps:**

- [ ] Test partial, complete, and over-receipt cases.
- [ ] Verify journal balance and stock totals.
- [ ] Run backwards-compatibility checklist.

**Rollback plan:** Disable partial receipt creation, preserve posted GRNs, and
restore from backup if schema backfill is incorrect.

**Notes / decisions:** ADR-010; financial sign-off required.

### CR-003: Complete sales return and refund workflow

**Status:** Proposed
**Class:** 💰
**Module(s):** POS / Inventory / B2B / Finance / Analytics
**Requested by:** Project maintainers
**Date:** 2026-10-20
**Why:** The schema contains `sales.is_return`, but the current checkout
function does not implement a complete return workflow. Returns need explicit
inventory, tax, payment, invoice, and journal treatment.
**What:**

- Define original-sale linkage and return quantities.
- Apply stock and customer/cash adjustments exactly once.
- Post reviewed reversal/refund entries with source references.

**Touches:**

- Files: `server.js`, `db.sql`, `index.html`
- Schema: likely return linkage and line-level return records; design pending
- Permissions: cashier/manager policy must be approved
- Financial impact: yes; revenue, VAT, COGS, inventory, cash/AR

**Acceptance criteria:**

- [ ] Returns cannot exceed quantities remaining on the source sale.
- [ ] Return totals and tax follow the approved tax policy.
- [ ] Inventory and journals reconcile to the return transaction.

**Verification steps:**

- [ ] Test full, partial, and duplicate return requests.
- [ ] Verify balanced journals and analytics exclusion/sign conventions.
- [ ] Record Owner/accountant sign-off.

**Rollback plan:** Disable new return writes while preserving return and
reversal records; correct via approved journal reversal, not destructive
deletion.

**Notes / decisions:** ADR required before implementation.

### CR-004: Enforce customer credit limits

**Status:** Proposed
**Class:** 💰
**Module(s):** POS / B2B / Credit
**Requested by:** Project maintainers
**Date:** 2026-10-20
**Why:** Customer limits and usage are stored, but the current on-account sale
path does not reject a balance above the limit.
**What:**

- Validate available credit transactionally when creating an on-account sale.
- Define manager/owner override behavior and audit attribution.

**Touches:**

- Files: `server.js`, `db.sql`, `index.html`
- Schema: no new table required unless overrides need audit records
- Permissions: override permission may be required
- Financial impact: yes; AR and receivables risk

**Acceptance criteria:**

- [ ] A sale within the limit succeeds.
- [ ] A sale exceeding the limit is rejected atomically unless an authorized
  override applies.
- [ ] Concurrent sales cannot overspend the same remaining credit.

**Verification steps:**

- [ ] Test within-limit, over-limit, override, and concurrent requests.
- [ ] Verify rejected sales create no sale, invoice, or journal.
- [ ] Record Owner sign-off.

**Rollback plan:** Restore prior checkout policy while retaining the transaction
guard and audit records if introduced.

**Notes / decisions:** ADR required; current gap is noted in G-016 and G-023.

### CR-005: Add a focused automated regression suite

**Status:** Proposed
**Class:** ⚙️
**Module(s):** API / Database / Finance
**Requested by:** Project maintainers
**Date:** 2026-10-20
**Why:** The package currently has no test runner, leaving schema, auth,
permission, trigger, and ledger behavior without repeatable automated checks.
**What:**

- Select a test runner and isolated PostgreSQL strategy.
- Cover critical route contracts and database side effects.
- Integrate the focused suite into CI.

**Touches:**

- Files: `package.json`, `server.js`, `db.sql`, `index.html`, CI configuration
- Schema: no production schema changes
- Permissions: test fixtures for existing permission keys
- Financial impact: validation only

**Acceptance criteria:**

- [ ] Tests run without production credentials or production data.
- [ ] Critical POS, GRN, auth, permission, and journal cases are covered.
- [ ] CI reports failures as blocking checks.

**Verification steps:**

- [ ] Run test suite from a clean checkout.
- [ ] Confirm database cleanup is isolated to the test database.
- [ ] Run backwards-compatibility checklist.

**Rollback plan:** Revert test tooling/CI wiring without changing production
application behavior.

**Notes / decisions:** Keep existing `npm run load-test` separate from
correctness tests.

### Change request template

```markdown
### CR-NNN: <Short Title>
**Status:** Proposed | Approved | In Progress | Shipped | Rejected
**Class:** 🔧 | ⚙️ | 🗄️ | 🔐 | 💰
**Module(s):** <modules>
**Requested by:** <role or name>
**Date:** YYYY-MM-DD
**Why:** <business reason>
**What:**
- <concrete outcome>
**Touches:**
- Files: <files>
- Schema: yes/no — <tables and columns>
- Permissions: yes/no — <keys and roles>
- Financial impact: yes/no — <accounts and tax effects>
**Acceptance criteria:**
- [ ] <observable behavior>
**Verification steps:**
- [ ] <test>
**Rollback plan:** <safe recovery>
**Notes / decisions:** <ADR references>
```

## 7. Prompt Library

### Add a new module

> You are working on HardwareOps Optimizer. Read `project.md` first. Then
> implement the approved module using the existing three core application
> files (`server.js`, `db.sql`, `index.html`) unless an ADR approves a
> supporting file. Inspect existing schema, routes, triggers, renderer and
> permissions before editing. Use `fn_next_number` for new numbered documents,
> `fn_post_journal` for every GL write, parameterized SQL, server-side
> authorization, escaped frontend output, and the verification process in
> Section 5.7. Update the API/schema inventories, acceptance criteria, and
> change request entry. Do not claim a behavior is shipped until it is tested.

### Add a schema field to an existing table

> You are working on HardwareOps Optimizer. Read `project.md` first. Then
> add the field with an idempotent migration/backfill plan. Check foreign
> keys, constraints, seed data, every query that reads or writes the table,
> and both `db.sql` and `initializeFinanceSchema()` where Finance bootstrap
> overlaps. Preserve old API responses unless the change request explicitly
> approves a contract change. Never rerun the destructive base schema script
> against valuable data.

### Add a new report to an existing module

> You are working on HardwareOps Optimizer. Read `project.md` first. Then
> define the report's data contract and accounting/date semantics before
> implementation. Keep calculations on the server/database, parameterize
> filters, add the endpoint and renderer in the existing patterns, escape
> displayed data, and verify boundary dates, empty results, role permissions,
> and numerical totals. Do not present a basic aggregate as a statutory
> statement without review.

### Fix a bug

> You are working on HardwareOps Optimizer. Read `project.md` first. Then
> reproduce the bug and trace its route, SQL, triggers, frontend consumer,
> and permission behavior before changing code. Make a surgical fix, preserve
> existing contracts, add a focused regression check, and verify rollback and
> retry behavior for mutations. Do not retry document-number or financial
> writes blindly.

### Refactor without breaking the three-file core

> You are working on HardwareOps Optimizer. Read `project.md` first. Then
> refactor only after identifying the existing public API, SQL, trigger, and
> browser contracts. Keep feature behavior in `server.js`, `db.sql`, and
> `index.html`; supporting files already exist for runtime/deployment tasks.
> Do not add a new feature module file unless an ADR approves it. Run focused
> behavior checks and update documentation only for changed facts.

### Write an ADR for a decision

> You are working on HardwareOps Optimizer. Read `project.md` first. Then
> draft an ADR with a unique number, context, decision, consequences, and
> rejected alternatives. State the exact code/schema/API/permission surfaces
> affected, identify financial and security implications, and specify
> verification and rollback. Distinguish current implementation from future
> intent; do not describe a proposal as already shipped.

## 8. Appendix

### 8.1 Glossary

| Term | Meaning in this application |
|---|---|
| AP | Accounts payable; current operational balances are derived from GRNs |
| AR | Accounts receivable; current balances are derived from invoices |
| B2B | Business-to-business customer/sale workflow |
| B2C_DIY | Seeded walk-in/consumer customer type |
| COA | Chart of accounts |
| Contra account | Account marked `contra = TRUE`; displayed as a contra balance |
| COGS | Cost of goods sold |
| Finance bootstrap | Runtime schema, seed, trigger, permission, and opening-journal initialization |
| GL | General ledger represented by `journal_entries` and `journal_lines` |
| GMROI | Gross margin return on inventory investment; current view uses gross margin divided by current inventory cost |
| GRN | Goods Received Note; receipt document linked to a PO |
| IRD | Sri Lanka Inland Revenue Department; master stores IRD tax codes but does not submit filings |
| Journal entry | Header row in `journal_entries` with one or more `journal_lines` |
| LKR | Sri Lankan rupee |
| Number series | `number_series` counter used to allocate business document IDs |
| PO | Purchase Order |
| POS | Point of sale |
| Period lock | A date-through control that blocks journal dates on or before a configured date |
| Price tier | Customer pricing discount configuration applied by POS function |
| Shrinkage | Inventory loss recorded in `shrink_incidents` |
| UOM | Unit of measure |
| VAT | Value Added Tax; configured tax rates are stored in `tax_codes` |

#### Schema inventory

The base schema defines the following 35 tables. Finance objects are also
bootstrapped from `server.js`; see G-019.

| Area | Tables |
|---|---|
| Authorization | `roles`, `role_permissions`, `users`, `auth_sessions` |
| Numbering | `number_series` |
| Masters | `uoms`, `tax_codes`, `categories`, `locations`, `payment_terms`, `price_tiers`, `brands`, `suppliers`, `customers`, `items` |
| Inventory and purchasing | `inventory`, `purchase_orders`, `po_lines`, `grns`, `grn_lines` |
| Sales and operations | `sales`, `sale_lines`, `invoices`, `service_tickets`, `rental_contracts`, `shrink_incidents` |
| Finance | `chart_of_accounts`, `journal_entries`, `journal_lines`, `expense_categories`, `expenses`, `fixed_assets`, `budgets`, `period_locks`, `bank_reconciliations` |

### 8.2 Full chart of accounts (as shipped)

Seeded accounts below reflect `db.sql` and are also inserted by Finance schema
bootstrap. Account codes are integration contracts and are referenced in
posting/report SQL.

| Code | Name | Type | Parent | Contra |
|---|---|---|---|---|
| 1100 | Cash and Cash Equivalents | Asset | — | No |
| 1110 | Bank Current Account | Asset | — | No |
| 1200 | Accounts Receivable | Asset | — | No |
| 1300 | Inventory | Asset | — | No |
| 1400 | Cost of Goods Sold | COGS | — | No |
| 1500 | Fixed Assets | Asset | — | No |
| 1510 | Equipment | Asset | 1500 | No |
| 1520 | Vehicles | Asset | 1500 | No |
| 1690 | Accumulated Depreciation | Asset | — | Yes |
| 2100 | Accounts Payable | Liability | — | No |
| 2200 | VAT Payable | Liability | — | No |
| 2210 | VAT Receivable | Asset | — | No |
| 2300 | Customer Deposits | Liability | — | No |
| 2400 | Accrued Expenses | Liability | — | No |
| 2500 | Other Tax Payable | Liability | — | No |
| 3000 | Owners Equity | Equity | — | No |
| 3100 | Retained Earnings | Equity | — | No |
| 3200 | Owner Drawings | Equity | — | Yes |
| 4100 | Sales Revenue | Revenue | — | No |
| 4200 | Service Revenue | Revenue | — | No |
| 4300 | Rental Revenue | Revenue | — | No |
| 4400 | Other Income | Revenue | — | No |
| 4900 | Sales Returns | Revenue | — | Yes |
| 5100 | Operating Expenses | Expense | — | No |
| 6100 | Rent Expense | Expense | — | No |
| 6200 | Utilities Expense | Expense | — | No |
| 6300 | Travel Expense | Expense | — | No |
| 6400 | Supplies Expense | Expense | — | No |
| 6500 | Depreciation Expense | Expense | — | No |
| 6600 | Shrinkage Expense | Expense | — | No |
| 6700 | Bank Charges | Expense | — | No |
| 6800 | Repairs and Maintenance | Expense | — | No |
| 6900 | Other Expense | Expense | — | No |

### 8.3 Full permission matrix per role

`T` means the seeded permission row grants access; `—` means false. The
Finance bootstrap inserts missing Finance rows but uses `ON CONFLICT DO
NOTHING`, so an existing grant can differ from the seed until explicitly
updated.

| Permission key | Owner | Manager | Cashier | Storekeeper | Accountant |
|---|:---:|:---:|:---:|:---:|:---:|
| `dashboard` | T | T | — | T | T |
| `pos` | T | T | T | — | — |
| `inventory` | T | T | — | T | — |
| `po` | T | T | — | T | — |
| `grn` | T | T | — | T | — |
| `services` | T | T | T | — | — |
| `rentals` | T | T | T | T | — |
| `b2b` | T | T | — | — | T |
| `shrink` | T | T | — | T | — |
| `gmroi` | T | T | — | — | T |
| `analytics` | T | T | — | — | T |
| `masters` | T | T | — | T | — |
| `masters_edit` | T | T | — | T | — |
| `numberseries` | T | T | — | — | T |
| `users_manage` | T | — | — | — | — |
| `finance` | T | T | — | — | T |
| `finance_edit` | T | T | — | — | T |

Role descriptions in `db.sql` call Accountant “Read-only financials,” but the
actual seeded and Finance-bootstrap grant for `finance_edit` is true. Treat
the table above as source truth and reconcile policy before changing it.

### 8.4 Full API endpoint inventory

All paths are under `/api` unless shown otherwise. Except login/logout, the
global API middleware requires authentication. “Finance” routes additionally
use the Finance view/edit middleware as noted. Other operational routes do
not all have module-specific permission middleware; see G-016 and G-023.

#### Authentication, users, permissions, and numbering

| Method | Path | Purpose / guard |
|---|---|---|
| POST | `/login` | Authenticate email/password and issue session token |
| POST | `/logout` | Delete current session token if supplied |
| GET | `/me` | Return current authenticated user |
| GET | `/users` | List users and role data |
| GET | `/users/:id` | Read one user |
| POST | `/users` | Create user; `requireUserManage` |
| PUT | `/users/:id` | Edit user; `requireUserManage` |
| PUT | `/users/:id/status` | Activate/deactivate user; `requireUserManage` |
| DELETE | `/users/:id` | Delete user; `requireUserManage` |
| PUT | `/users/:id/password` | Change password; route-specific authorization |
| GET | `/permissions` | Read permission matrix |
| PUT | `/permissions/:role/:perm` | Update role grant; inspect current code before treating as Owner-only |
| GET | `/number-series` | List document number series |
| POST | `/number-series/:code/reset` | Reset series counter |
| POST | `/number-series/:code/advance` | Advance series counter |

#### Finance

All Finance GET routes require `finance`; Finance mutations require
`finance_edit`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/finance/accounts` | List chart of accounts |
| GET | `/finance/journal` | List journal lines; optional `from`, `to`, `source`, `account` filters |
| POST | `/finance/journal` | Post manual journal through `fn_post_journal` |
| GET | `/finance/ledger/:account` | List activity for one account |
| GET | `/finance/trial-balance` | Aggregate debit, credit, and balance by account |
| GET | `/finance/pnl` | Aggregate revenue, COGS, expenses, and net profit |
| GET | `/finance/balance-sheet` | Aggregate assets, liabilities, and equity |
| GET | `/finance/cash-flow` | Sum cash-account inflow/outflow; optional `from`, `to` |
| GET | `/finance/aging/ar` | List open invoice balances and aging buckets |
| POST | `/finance/aging/ar/:invoiceId/receive` | Apply invoice receipt and reduce customer credit usage |
| GET | `/finance/aging/ap` | List unpaid GRN balances and aging buckets |
| POST | `/finance/aging/ap/:grnId/pay` | Apply AP payment and post journal |
| GET | `/finance/expenses` | List expense vouchers |
| GET | `/finance/expense-categories` | List expense category/account mappings |
| POST | `/finance/expenses` | Create posted expense voucher and trigger journal |
| GET | `/finance/vat-return` | Sum output/input VAT; optional `from`, `to` |
| GET | `/finance/fixed-assets` | List fixed assets |
| POST | `/finance/fixed-assets` | Create fixed asset and acquisition journal |
| POST | `/finance/fixed-assets/depreciate` | Post monthly depreciation for `YYYY-MM` |
| GET | `/finance/budgets` | List budgets |
| PUT | `/finance/budgets/:period/:code` | Create/update budget row |
| GET | `/finance/period-lock` | List period locks |
| POST | `/finance/period-lock` | Add a lock-through date |
| GET | `/finance/bank-recon` | List bank-reconciliation lines/status |
| POST | `/finance/bank-recon/:jeLineId` | Mark a journal line reconciled |

#### Masters

| Method | Path | Purpose / guard |
|---|---|---|
| GET | `/suppliers` | List suppliers |
| POST | `/suppliers` | Create supplier; `requireMasterEdit` |
| PUT | `/suppliers/:id` | Edit supplier; `requireMasterEdit` |
| DELETE | `/suppliers/:id` | Delete supplier; `requireMasterEdit` |
| GET | `/categories` | List categories |
| POST | `/categories` | Create category; `requireMasterEdit` |
| PUT | `/categories/:id` | Edit category; `requireMasterEdit` |
| DELETE | `/categories/:id` | Delete category; `requireMasterEdit` |
| GET | `/brands` | List brands |
| POST | `/brands` | Create brand; `requireMasterEdit` |
| PUT | `/brands/:id` | Edit brand; `requireMasterEdit` |
| DELETE | `/brands/:id` | Delete brand; `requireMasterEdit` |
| GET | `/tax-codes` | List tax codes |
| POST | `/tax-codes` | Create tax code; `requireMasterEdit` |
| PUT | `/tax-codes/:id` | Edit tax code; `requireMasterEdit` |
| DELETE | `/tax-codes/:id` | Delete tax code; `requireMasterEdit` |
| GET | `/uoms` | List units of measure |
| POST | `/uoms` | Create UOM; `requireMasterEdit` |
| PUT | `/uoms/:id` | Edit UOM; `requireMasterEdit` |
| DELETE | `/uoms/:id` | Delete UOM; `requireMasterEdit` |
| GET | `/locations` | List locations |
| POST | `/locations` | Create location; `requireMasterEdit` |
| PUT | `/locations/:id` | Edit location; `requireMasterEdit` |
| DELETE | `/locations/:id` | Delete location; `requireMasterEdit` |
| GET | `/price-tiers` | List price tiers |
| POST | `/price-tiers` | Create price tier; `requireMasterEdit` |
| PUT | `/price-tiers/:id` | Edit price tier; `requireMasterEdit` |
| DELETE | `/price-tiers/:id` | Delete price tier; `requireMasterEdit` |
| GET | `/payment-terms` | List payment terms |
| POST | `/payment-terms` | Create payment term; `requireMasterEdit` |
| PUT | `/payment-terms/:id` | Edit payment term; `requireMasterEdit` |
| DELETE | `/payment-terms/:id` | Delete payment term; `requireMasterEdit` |
| GET | `/customers` | List customers |
| POST | `/customers` | Create customer; `requireMasterEdit` |
| PUT | `/customers/:id` | Edit customer; `requireMasterEdit` |
| DELETE | `/customers/:id` | Delete customer; `requireMasterEdit` |
| GET | `/items` | List items/inventory |
| POST | `/items` | Create item; `requireMasterEdit` |
| PUT | `/items/:id` | Edit item; `requireMasterEdit` |
| DELETE | `/items/:id` | Delete item; `requireMasterEdit` |

#### Sales, analytics, purchasing, and operations

| Method | Path | Purpose |
|---|---|---|
| POST | `/sales` | Create POS sale and invoke sale finance posting |
| GET | `/sales` | List sales; optional `from`, `to` |
| GET | `/sales/:id/lines` | List lines for one sale |
| GET | `/analytics/summary` | Sales summary for daily/weekly/monthly period |
| GET | `/analytics/items` | Item sales, cost, and gross-profit report |
| GET | `/analytics/cash-credit` | Sale/payment list for a period |
| GET | `/analytics/customer-credit` | Customer credit view |
| GET | `/analytics/supplier-purchases` | Supplier PO/purchase summary |
| GET | `/analytics/gmroi` | Category GMROI view |
| GET | `/purchase-orders` | List POs and lines |
| POST | `/purchase-orders` | Create PO and lines |
| POST | `/grns` | Receive all lines on a PO |
| GET | `/grns` | List GRNs and lines |
| GET | `/invoices` | List invoices |
| POST | `/invoices/:id/pay` | Apply invoice payment through operational invoice route |
| GET | `/services` | List service tickets |
| POST | `/services` | Create service ticket |
| GET | `/rentals` | List rental contracts |
| POST | `/rentals` | Create rental contract |
| GET | `/shrink` | List shrink incidents |
| POST | `/shrink` | Create shrink incident |

### 8.5 Full trigger inventory

| Trigger | Fires on | Effect |
|---|---|---|
| `trg_sale_lines_apply` | `AFTER INSERT` on `sale_lines`, each row | Decrements inventory and sets item's `last_sold` to `CURRENT_DATE` |
| `trg_grn_lines_apply` | `AFTER INSERT` on `grn_lines`, each row | Increments inventory |
| `trg_shrink_incidents_apply` | `AFTER INSERT` on `shrink_incidents`, each row | Decrements inventory |
| `trg_grn_lines_finance` | `AFTER INSERT` on `grn_lines`, statement-level transition table | Posts one Finance journal per distinct GRN ID in inserted rows |
| `trg_shrink_finance` | `AFTER INSERT` on `shrink_incidents`, each row | Posts shrink expense against inventory when incident value is positive |
| `trg_service_finance` | `AFTER INSERT` on `service_tickets`, each row | Posts AR debit and service revenue credit for positive-price service |
| `trg_rental_finance` | `AFTER INSERT` on `rental_contracts`, each row | Posts AR debit and rental revenue credit for positive computed amount |
| `trg_invoice_payment_finance` | `AFTER UPDATE OF amount_paid` on `invoices`, when amount increases | Posts cash debit and AR credit for the amount-paid delta |
| `trg_expense_finance` | `AFTER INSERT` on `expenses`, each row | Posts expense debit and cash credit when `posted = TRUE` |

Finance posting functions also contain source/ref lookups and keyed advisory
locks in several event paths. POS posting is explicitly invoked from
`sp_complete_sale` and the `/sales` API transaction; there is no sales Finance
trigger in the current active trigger inventory.

### 8.6 Full view inventory

| View | Purpose |
|---|---|
| `v_item_sales` | Non-return sale-line quantities, revenue, cost, and gross profit by date and SKU |
| `v_customer_credit` | Customer credit limit, used/available amounts, and unpaid invoice total for non-B2C customers |
| `v_supplier_purchases` | Supplier PO count and total/received/open purchase values |
| `v_gmroi_category` | Category gross margin, current cost-valued inventory, retail value, and GMROI |

Finance statements and other reports primarily use direct route queries rather
than dedicated Finance views in the current source.
