# Finance Module — Skills Required

## Domain Skills

### Double-Entry Accounting
- Debits and credits, normal balances per account type.
- Journal → Ledger → Trial Balance → P&L / Balance Sheet flow.
- Contra accounts (Accumulated Depreciation on Asset side; Drawings, Sales Returns).
- Retained earnings roll-forward (period P&L closes into equity on reporting).
- Cash Flow Statement via indirect derivation from cash/bank account movement.

### Sri Lanka Statutory Context
- VAT at 18% standard rate (VAT18), 8% concession (VAT8), 0% exempt (VAT0).
- VAT returns: **Output VAT** (Sales, account 2200) minus **Input VAT**
  (Purchases, account 2210) = Net payable/refundable. Filed monthly,
  due by the 20th of the following month.
- IRD codes on tax master: `VAT-STD`, `VAT-EXM`, `VAT-CON`.
- Currency: LKR, formatted `Rs 1,234.56` via `toLocaleString('en-LK')`.

### Depreciation
- Straight line: `(cost − salvage) / (life_years × 12)` per month.
- Accumulated depreciation is a contra-asset. Stop posting once
  `accumDep + monthly > cost − salvage`.
- Post once per calendar month (guard via journal `source='Depreciation' AND ref='YYYY-MM'`).

### AR / AP Aging
- Standard buckets: Current (not yet due), 1–30, 31–60, 61–90, 90+.
- AR = `invoices WHERE status != 'Paid'`, aged by `due_date` vs `as-of-date`.
- AP = `grns WHERE paid = FALSE`, aged by `date_received`.

## Technical Skills — Backend

### PostgreSQL
- Schema design with FK chains: `journal_entries → journal_lines → chart_of_accounts`.
- CHECK constraints on account type (`Asset | Liability | Equity | Revenue | COGS | Expense`).
- `NUMERIC(14,2)` for money; never `FLOAT`.
- `plpgsql` functions and triggers — you must know:
  - `RETURNS TRIGGER`, `RETURNS TEXT` (for next-number generators).
  - `FOR v_line IN SELECT * FROM jsonb_array_elements(...) LOOP`.
  - `AFTER INSERT ON … FOR EACH ROW EXECUTE FUNCTION`.
  - Exception blocks (`RAISE EXCEPTION 'reason' USING HINT = …`).
- `CREATE OR REPLACE VIEW` for reporting views (like existing `v_gmroi_category`).
- Advisory locks (`pg_advisory_xact_lock`) — already used by user CRUD; you
  should reuse the pattern to serialize period-lock writes.
- `pg.Pool` behaviour when `max = 1` — **all** queries serialize. Triggers must
  stay fast (no network, no external calls, no nested long transactions).

### Express / Node ESM
- New routers mounted under `/api/finance` **after** `app.use("/api", requireAuth)`.
- Reuse `wrap(fn, source)` for consistent error + pool-exhaustion handling.
- Reuse `handleDatabaseBusy(err, req, res, source)` on any new route.
- Reuse `requireMasterEdit`-style guard: write `requireFinanceEdit` — same
  pattern but queries `perm_key = 'finance_edit'`.
- Return `{ error: "…" }` on failure — the frontend `api()` helper parses this.
- Log the requestId context from `requestContext` — new finance endpoints
  inherit it automatically.

## Technical Skills — Frontend

### Vanilla JS SPA patterns (already in `index.html`)
- `api(path, opts)` — auto-attaches bearer token, retries on 503 `database_busy`.
- `table(rows)` — `[head, ...body]` in, `<table>` HTML out.
- `money(n)` — LKR formatter.
- `$ = id => document.getElementById(id)`.
- Panel switching via `[data-panel]` on nav buttons and `.panel.active`.
- Master-tab switching via `[data-master]` on `.master-tabs button` and
  `.master-view.active`.
- Toast pattern: `toast(msg, "ok" | "err")`.

### Consistent rendering
- KPI cards use `.kpi .label / .value / .meta` classes.
- Status chips use `.badge` + one of `ok|warn|bad|info|blue|gold|purple`.
- Empty states: `<p style="color:#888;font-size:13px;">…</p>`.
- All currency through `money()` — never raw `toFixed`.

### Permission-awareness
- `can(perm)` gates the UI.
- Buttons that mutate must `if (!can('finance_edit')) return toast('Permission denied','err')`.
- Nav buttons auto-disable via `applyPermissions()` when the current role
  lacks `finance`.

## Integration Skills

### Existing hook points you MUST use
- `fn_next_number(code)` — for JE and EXP series. Add both to `number_series`.
- Existing trigger pattern — see `trg_sale_line_apply` in db.sql.
- Existing stored procedure `sp_complete_sale(...)` — pick **one** auto-post
  strategy: either modify this proc to write JEs **or** add a separate
  AFTER-INSERT trigger on `sales`. See memory.md → "Auto-post Decision".
- Existing analytics view pattern — match your `v_fin_*` view naming.
- Existing `ensureAuthSchema()` idempotent bootstrap — add `initializeFinanceSchema()`
  alongside it (same `globalThis[Symbol.for(...)]` memo pattern).

### Testing without a test framework
- The codebase has no test runner. Verify by:
  1. `npm start` → open `/`
  2. Login as Owner → POST a sale → check `/api/finance/journal`
  3. Assert TB balances via console or curl.
  4. Switch role → assert 403s and hidden nav.

## Anti-patterns to Avoid
- ❌ Do not introduce another node process or worker.
- ❌ Do not add a router file per feature — server.js is a single file today.
- ❌ Do not add a frontend framework or bundler.
- ❌ Do not use `DOUBLE PRECISION` for money.
- ❌ Do not write JS-side JE lines in the frontend — all JE construction must
  happen server-side (in SQL proc/trigger or in an Express handler), never in
  `index.html`. Otherwise the data is not auditable or consistent.
- ❌ Do not skip the `period_locks` guard — backdated entries are how you
  accidentally restate a closed month.