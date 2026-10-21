# HardwareOps Optimizer

HardwareOps Optimizer is an operations dashboard for a hardware retailer,
available as a browser-based app and a cross-platform Electron desktop app. It
combines point-of-sale, stock, purchasing, credit, service, rental, and sales
analytics workflows with role-based access.

## Features

- Dashboard with inventory, sales, VAT, low-stock, purchase-order, and receivables
  summaries
- Point of sale, inventory management, purchase orders, and goods received notes
- Customer credit, invoices, services, rentals, and shrinkage tracking
- Finance CRUD for expenses, fixed assets, budgets, and bank reconciliation,
  with correcting journal entries posted on the current accounting date for
  posted changes; journal entries and period locks remain protected to preserve
  the accounting audit trail
- Chart of accounts management with protected built-in accounts and safeguards
  against deleting accounts referenced by ledger activity or other finance data
- Print and CSV export for sales, operations, analytics, and finance tables
- Sales analytics and GMROI reporting
- Master data for suppliers, items, categories, brands, locations, tax codes,
  units of measure, payment terms, and price tiers
- Create, edit, and delete actions for suppliers, items, customers, and other
  master records; records referenced by existing business data cannot be deleted
- Role-based permissions for Owner, Manager, Cashier, Storekeeper, and
  Accountant accounts
- User account creation, profile and role editing, and safe deactivation/reactivation;
  deactivated users are signed out while their business history is retained
- Email-and-password sign-in with expiring server-side sessions

## Requirements

- Node.js 18 or later
- PostgreSQL
- npm

## Environment Variables

Set these values in a private `.env` file for local development, or in the
appropriate project environment settings for deployment. Never commit real
database URLs, passwords, or other credentials.

### Database connection

Choose one of these configuration styles:

| Variable | Required | Description |
|---|---|---|
| `DATABASE_TARGET` | Optional | Selects `local` or `aiven`. When set, the app uses the matching `DATABASE_URL_LOCAL` or `DATABASE_URL_AIVEN`. Any other value is an error. |
| `DATABASE_URL` | Required if `DATABASE_TARGET` is unset | PostgreSQL connection URL, for example `postgresql://USER:PASSWORD@HOST:5432/DBNAME`. |
| `DATABASE_URL_LOCAL` | Required when `DATABASE_TARGET=local` | PostgreSQL URL for the local database. The app forces SSL off for this target. |
| `DATABASE_URL_AIVEN` | Required when `DATABASE_TARGET=aiven` | PostgreSQL URL for Aiven. The app forces SSL on for this target. |
| `PGSSLMODE` | Optional | SSL mode when `DATABASE_TARGET` is unset: `require` or `disable`. Defaults to the URL's `sslmode` parameter, then `disable`. `DATABASE_TARGET=local` and `DATABASE_TARGET=aiven` override this setting. |
| `PG_POOL_MAX` | Optional | Maximum PostgreSQL connections in each Node.js process's pool. Defaults to `1`; for Aiven Hobbyist keep it at `1`. This is a per-process/instance limit, not a fleet-wide limit. |

If `DATABASE_TARGET` is not set, `DATABASE_URL` is used. Otherwise the selected
target requires its matching URL. URLs must use the `postgres://` or
`postgresql://` scheme. Do not put credentials in source code or logs.

Example local configuration:

```dotenv
DATABASE_TARGET=local
DATABASE_URL_LOCAL=postgresql://USER:PASSWORD@127.0.0.1:5432/hardwareops
PG_POOL_MAX=1
```

Example direct Aiven configuration:

```dotenv
DATABASE_TARGET=aiven
DATABASE_URL_AIVEN=postgresql://USER:PASSWORD@AIVEN_HOST:PORT/hardwareops
PG_POOL_MAX=1
```

### API and first-owner setup

| Variable | Required | Description |
|---|---|---|
| `PORT` | Optional | Local API listen port. Defaults to `4000`. Vercel assigns its own port; do not set this for Vercel deployments. |
| `AUTH_BOOTSTRAP_EMAIL` | Optional | Email address of the existing active Owner account whose initial password may be set. Defaults to `rick@store.lk`. |
| `AUTH_BOOTSTRAP_PASSWORD` | Optional | Password to set for that Owner only if the account currently has no password. Must be at least 12 characters. Leave unset if bootstrap password setup is not needed. |

The bootstrap password is only applied during the auth schema initialization
when the selected active Owner account has no password hash. It does not reset
an existing password. Keep it secret and remove it from deployment
configuration after initial setup if it is no longer needed.

### Vercel Hobby deployment

| Variable | Required | Description |
|---|---|---|
| `VERCEL_BETA_MAX_CONCURRENCY` | Optional platform opt-in | Set to `1` in Vercel project environment settings to opt into the beta `maxConcurrency` function setting. Review Vercel's applicable pricing and redeploy after setting it. |

The repository configures `maxConcurrency` as `20` in `vercel.json`. This is
not a global limit on the number of Vercel instances or database connections.
See [Aiven Hobbyist deployment](#aiven-hobbyist-deployment) for the connection
limit and monitoring guidance.

### Load-test options

These variables are used only by `npm run load-test`:

| Variable | Required | Description |
|---|---|---|
| `LOAD_TEST_BASE_URL` | Optional | Base URL of the API to test; defaults to `http://localhost:4000`. |
| `LOAD_TEST_CONCURRENCY` | Optional | Number of concurrent requests; defaults to `56` and must be at least `56`. |
| `AUTH_BOOTSTRAP_EMAIL` | Required by load test | Credentials for the test login; defaults in the application do not substitute for this load-test requirement. |
| `AUTH_BOOTSTRAP_PASSWORD` | Required by load test | Password for the test login. |

## Setup

1. Install the Node.js dependencies:

   ```sh
   npm install
   ```

2. Create PostgreSQL databases as needed and configure both connections in
   `.env`. Change `DATABASE_TARGET` to switch the app between them:

   ```dotenv
   DATABASE_TARGET=local
   DATABASE_URL_LOCAL=postgresql://postgres:YOUR_LOCAL_PASSWORD@127.0.0.1:5432/hardwareops
   DATABASE_URL_AIVEN=postgresql://USER:PASSWORD@HOST:PORT/hardwareops?sslmode=require
   PORT=4000
   AUTH_BOOTSTRAP_EMAIL=rick@store.lk
   AUTH_BOOTSTRAP_PASSWORD=replace-with-a-unique-password-of-at-least-12-characters
   ```

   Local connections use SSL disabled; Aiven connections use SSL. Replace the
   example URLs with your actual credentials. Keep `.env` private and do not
   commit database credentials or passwords.

3. Initialize the database schema and sample data if the database is new:

   ```sh
   psql "$DATABASE_URL_LOCAL" -f db.sql
   ```

   Use `$DATABASE_URL_AIVEN` instead when initializing the Aiven database.

   **Warning:** `db.sql` drops and recreates the application tables. Running it
   against an existing database deletes its current data.

4. Start the API:

   ```sh
   npm start
   ```

   The API listens on `http://localhost:4000` by default. On startup it adds
   the password-hash column and session table if they do not already exist.
   `AUTH_BOOTSTRAP_PASSWORD` sets the configured Owner account's password only
   when that account does not already have a password.

5. Serve `index.html` from a local web server and open it in a browser. For
   example, use VS Code Live Server on port 5500. The frontend expects the API
   at `http://localhost:4000`; deployments using another API URL can set
   `window.HARDWAREOPS_API` before the page's application script runs.

6. Sign in with the configured Owner email and password. The Owner can set
   passwords for other accounts in **Masters → Users**. Passwords must contain
   at least 12 characters.

## Vercel deployment

The project can be deployed to Vercel as an Express serverless app with a web frontend.

1. Import the repository into Vercel and keep the default framework settings so Vercel uses the Express app exported from `server.js`.
2. Import [`vercel.env.example`](./vercel.env.example) into the Vercel
   project's Environment Variables settings, or copy its entries there.
   Before importing, replace every `YOUR_...` and `REPLACE_...` placeholder
   with your actual values. URL-encode special characters in the database
   username and password. Never commit a completed file containing secrets.

   ```dotenv
   DATABASE_URL=postgresql://user:password@host:5432/hardwareops
   PGSSLMODE=require
   PG_POOL_MAX=1
   VERCEL_BETA_MAX_CONCURRENCY=1
   AUTH_BOOTSTRAP_EMAIL=rick@store.lk
   AUTH_BOOTSTRAP_PASSWORD=replace-with-a-unique-password-of-at-least-12-characters
   ```

   If you use a local PostgreSQL instance or a different provider, also set `DATABASE_TARGET` and the matching `DATABASE_URL_LOCAL` / `DATABASE_URL_AIVEN` variables as needed.

   On Vercel Hobby, `maxConcurrency` is a beta feature with different pricing. Opt in by setting `VERCEL_BETA_MAX_CONCURRENCY=1` in the Vercel project environment variables, then redeploy. The function configuration in `vercel.json` sets `maxConcurrency` to `20`; review Vercel's applicable pricing before opting in. This controls concurrency per function instance, not the total number of instances or total database connections.

   `PG_POOL_MAX` defaults to `1` per warm function instance. Monitor actual database connections: serverless instance scaling means the total pool connections cannot be guaranteed from this per-instance setting alone.

   The API reuses one `pg.Pool` per warm function instance, caps it at `PG_POOL_MAX`, and retires idle connections after 5 seconds. Authentication schema setup is cached once per warm instance. Finance schema setup runs on first finance use and is serialized across instances to avoid concurrent schema changes. For Aiven Hobbyist, use `PG_POOL_MAX=1`: there is no PgBouncer pooler, and the PostgreSQL limit is 25 total connections.

3. No custom build command is required. The Express app serves `index.html` at `/` and handles `/api/*` requests. Do not set `PORT`; Vercel assigns function ports automatically.
4. Once the project is deployed, open the site and sign in with the configured Owner account.

## Aiven Hobbyist deployment

Aiven Hobbyist supports at most 25 PostgreSQL connections and does not include
PgBouncer. Set `PG_POOL_MAX=1` in the Vercel production environment and retain
`maxConcurrency=20` in `vercel.json`. On Vercel Hobby, also set
`VERCEL_BETA_MAX_CONCURRENCY=1` in the project environment and redeploy to opt
in to the beta `maxConcurrency` setting; it has different pricing, so review
the applicable Vercel pricing before enabling it. `maxConcurrency` is a
per-instance request concurrency setting, not a global cap on function
instances; the setting therefore does not guarantee a 20-connection ceiling.
Each warm instance can hold up to `PG_POOL_MAX` database connections, so
Vercel scaling can still exceed Aiven's 25-connection limit, including
superuser-reserved slots and admin/migration connections. Inspect production
connections after deployments and during bursts rather than assuming this
configuration or a provider-side pooler will impose a fleet-wide limit.

Check the current user's connection count in the Aiven SQL console or with
`psql`:

```sql
SELECT count(*) FROM pg_stat_activity WHERE usename = current_user;
```

Keep the total below 25 with headroom for reserved and administrative sessions.
Idle connections attributable to the application are bounded by
`PG_POOL_MAX` per warm Vercel instance, not per deployment. If connection
exhaustion occurs under normal traffic or concurrency grows, move the API to a
deployment with a controlled instance count or upgrade to Aiven Startup and
use its PgBouncer pooling rather than raising PostgreSQL's connection limit
on Hobbyist.

To generate a local authenticated burst against a running API, configure
`LOAD_TEST_BASE_URL`, `AUTH_BOOTSTRAP_EMAIL`, and `AUTH_BOOTSTRAP_PASSWORD`,
then run `npm run load-test`. The harness sends 56 concurrent requests across
`/api/me`, `/api/login`, `/api/tax-codes`, `/api/invoices`, `/api/items`,
`/api/users`, `/api/suppliers`, `/api/grns`, and `/api/services`. It accepts
successful responses or the documented 503 `database_busy` response with
`Retry-After`, and fails on other errors.

## Desktop app

The desktop app starts the local API on an available loopback port and opens the
existing interface in an Electron window. PostgreSQL must be reachable from the
computer running the desktop app.

For development, install dependencies and run:

```sh
npm install
npm run desktop
```

The development app reads `.env` from the project root. In a packaged install,
the build bundles the project-root `.env` and uses it by default. A `.env` in
the app's user-data directory can override non-database settings in the bundled
configuration; database settings selected when the installer was built take
precedence. The user-data directory is `%APPDATA%/hardwareops` on Windows,
`~/Library/Application Support/hardwareops` on macOS, and
`~/.config/hardwareops` on Linux. The `.env` is included in the installer and
installed app resources, so anyone who obtains either can extract its database
credentials. Only distribute this build to trusted users; do not commit
credentials, and rotate them if the installer is exposed.

Build an installer/package for the current platform:

```sh
npm run dist
```

Or select a platform explicitly with `npm run dist:win`, `npm run dist:mac`, or
`npm run dist:linux`. Before Windows and Linux packaging, the build asks for a
company name and database target (`local` by default), creates the company
database, applies `db.sql`, and updates the matching database settings in the
repository `.env` while preserving its comments and other keys. Company names
are converted to lowercase database names using letters, numbers, and
underscores.

For a local target, enter the PostgreSQL superuser password when prompted
(press Enter to use `postgres`). Windows builds install PostgreSQL 16 with
winget if `psql` is missing; Linux builds require `psql` to already be on
`PATH`. The local PostgreSQL service must be startable by the current user.
For Aiven, configure `DATABASE_URL_AIVEN` with valid credentials in `.env`
before building; the setup uses the Aiven host and port configured for this
project.

**Warning:** `db.sql` drops and recreates application tables. If the selected
company database already exists, setup asks for confirmation before applying
the schema. Continue only when it is safe to replace those tables. Builds
should be produced on the target platform, particularly for macOS signing and
packaging.

## Project files

- `index.html` — application interface, styles, and browser-side API client
- `server.js` — Express API, PostgreSQL access, login, and session handling
- `electron/` — Electron main and secure preload processes
- `db.sql` — PostgreSQL schema and sample data
- `package.json` — runtime dependencies and npm scripts

## Development

Run the API with:

```sh
npm start
```

Run the desktop app with `npm run desktop`.

There is currently no automated project test suite configured in `package.json`.
