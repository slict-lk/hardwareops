# Finance Module — Scope

## Goal
Add a fully integrated, double-entry Finance module to the existing HardwareOps
Optimizer (Express + PostgreSQL + vanilla JS SPA) so that every stock, sale,
purchase, service, rental, and shrinkage event automatically produces
balanced accounting entries — and so the owner can produce P&L, Balance Sheet,
Cash Flow, TB, AR/AP aging, VAT return, fixed-asset depreciation, budgets,
bank reconciliation, and period close from live data.

## In Scope (v1)

### Backend (server.js + db.sql)
- New schema tables:
  - `chart_of_accounts` (code, name, type, parent, postable, contra)
  - `journal_entries` (id, date, description, source, ref, created_by)
  - `journal_lines` (je_id, account_code, debit, credit)
  - `expense_categories` (map GL code → friendly name)
  - `expenses` (voucher table with post state)
  - `fixed_assets` (cost, life, salvage, accumulated_depreciation)
  - `budgets` (period, account_code, amount)
  - `period_locks` (lock_through_date)
  - `bank_reconciliations` (je_line_id, reconciled_at, reconciled_by)
- New function: `fn_post_journal(date, description, source, ref, lines_jsonb, created_by)`
  returning the JE id; enforces Dr = Cr, rejects dates ≤ `period_locks.lock_through_date`.
- New helper: `fn_next_number('JE')` and `fn_next_number('EXP')` — register two
  new rows in `number_series`.
- New triggers / hooks (choose **one** strategy — see memory.md "Auto-post" note):
  - `trg_sale_lines_finance` on `sales` INSERT → posts the full sale JE
  - `trg_grn_lines_finance` on `grns` INSERT → posts per-supplier JE
  - `trg_shrink_finance` on `shrink_incidents` INSERT → posts shrinkage JE
  - `trg_service_finance` on `service_tickets` INSERT
  - `trg_rental_finance` on `rental_contracts` INSERT
  - `trg_expense_finance` on `expenses` INSERT (autopost if posted = FALSE skip; API sets posted)
  - `trg_invoice_pay_finance` on `invoices` UPDATE status='Paid'
  - `trg_depreciation_finance` — a nightly/manual API call, not a trigger
- New API endpoints under `/api/finance/…` (see memory.md → "API Contract"):
  - `GET  /api/finance/accounts`
  - `GET  /api/finance/journal` (+ filters: from, to, source, account)
  - `POST /api/finance/journal` (manual JE)
  - `GET  /api/finance/ledger/:account`
  - `GET  /api/finance/trial-balance`
  - `GET  /api/finance/pnl`
  - `GET  /api/finance/balance-sheet`
  - `GET  /api/finance/cash-flow`
  - `GET  /api/finance/aging/ar` · `GET /api/finance/aging/ap`
  - `POST /api/finance/aging/ar/:invoiceId/receive`
  - `POST /api/finance/aging/ap/:grnId/pay`
  - `GET  /api/finance/expenses` · `POST /api/finance/expenses`
  - `GET  /api/finance/vat-return`
  - `GET  /api/finance/fixed-assets` · `POST /api/finance/fixed-assets`
  - `POST /api/finance/fixed-assets/depreciate`
  - `GET  /api/finance/budgets` · `PUT /api/finance/budgets/:period/:code`
  - `GET  /api/finance/period-lock` · `POST /api/finance/period-lock`
  - `GET  /api/finance/bank-recon` · `POST /api/finance/bank-recon/:jeLineId`
- New permission keys: `finance` (view) and `finance_edit` (post/lock/expense).
- Seed rows:
  - ~38 COA accounts (Asset / Liability / Equity / Revenue / COGS / Expense)
  - Opening-balance JE dated before first transaction (derived from
    current `inventory.qty × items.cost`, unpaid `invoices`, received `grns`,
    `fixed_assets` values).
- Bootstrap: default grants — Owner, Manager, Accountant see + post;
  Cashier, Storekeeper see nothing.

### Frontend (index.html)
- New nav button: `💰 Finance` (gold accent, after Sales Analytics).
- New `<section class="panel" id="finance">` with 15 sub-tabs:
  Overview · Chart of Accounts · Journal · Ledger · Trial Balance ·
  P&L · Balance Sheet · Cash Flow · Bank & Recon · AR/AP Aging ·
  Expenses · VAT Return · Fixed Assets · Budget · Period Close.
- Uses existing `api()` helper, `table()` renderer, `.kpi` cards,
  `.badge`, `.fin-tabs` styles.
- New CSS: `.fin-tabs`, `.fin-view` — copy from memory.md "Frontend CSS".
- `PERMISSION_KEYS` array extended with `finance`, `finance_edit`.
- `applyPermissions()` extended to gate Finance nav + Finance sub-tabs.
- `renderFinance()` dispatcher — pattern mirrors `renderAnalytics()`.

## Out of Scope (v1)
- Multi-currency and FX revaluation
- Multi-entity / consolidation
- Payroll and statutory EPF/ETF filings
- Purchase requisitions and approval workflow
- Inventory valuation other than current `items.cost` snapshot
- Full IFRS/GAAP statements with notes to accounts
- Immutable audit trail (we keep created_at + created_by but allow reversal)
- Account-level user permission (permission is per-role only)
- Tax filing submission to IRD (only the working paper is produced)
- Electronic bank feeds (manual reconcile only)

## Constraints
- No build step. Single `index.html` served by `server.js`.
- Node ESM, `express`, `pg`, `cors`, `dotenv`.
- Pool max default 1 (`PG_POOL_MAX`) — assume single-connection concurrency.
- All money in LKR, rounded to 2 decimals in DB (`NUMERIC(14,2)`).
- All dates stored as `DATE` (YYYY-MM-DD) — no time zones in JE dates.
- Backwards compatible: existing tables, endpoints, permissions must keep
  working unchanged for non-finance users.

## Acceptance Criteria
1. After `db.sql` migration, `npm start`, and a fresh login as Owner:
   - Finance nav button is visible and enabled.
   - TB debits = credits (diff < Rs 0.01).
   - Balance Sheet "A − L − E" check badge is green.
2. A POS cash sale → `journal_entries` gains one row with source='POS',
   lines balance, and `journal_lines` include Dr 1100 / Cr 4100 / Cr 2200
   (if VAT) / Dr 5100 / Cr 1400.
3. A GRN → JE posted with Dr 1400 + Dr 2210 / Cr 2100.
4. A shrink incident → JE posted with Dr 6600 / Cr 1400.
5. Expenses API posts voucher → JE Dr 6xxx / Cr 1100 or 1200.
6. `POST /api/finance/aging/ar/:invoiceId/receive` moves invoice to Paid
   and creates JE Dr 1200 / Cr 1300.
7. `POST /api/finance/fixed-assets/depreciate` with `{period:"2026-10"}`:
   - Posts Dr 6500 / Cr 1690.
   - Returns 409 if already posted for that period.
8. Period lock at 2026-10-14 blocks backdated JEs with HTTP 422.
9. Cashier logged in → Finance nav is `.denied`, API returns 403 on
   `/api/finance/journal` with POST.
10. Cash Flow statement nets to cash + bank balance change over the period.