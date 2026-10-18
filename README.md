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

The project can be deployed to Vercel as a static frontend with a serverless API.

1. Import the repository into Vercel and keep the default framework settings since the app is served as a static site with a Node.js serverless function.
2. Set the production environment variables in the Vercel project settings:

   ```dotenv
   DATABASE_URL=postgresql://user:password@host:5432/hardwareops
   PGSSLMODE=require
   AUTH_BOOTSTRAP_EMAIL=rick@store.lk
   AUTH_BOOTSTRAP_PASSWORD=replace-with-a-unique-password-of-at-least-12-characters
   ```

   If you use a local PostgreSQL instance or a different provider, also set `DATABASE_TARGET` and the matching `DATABASE_URL_LOCAL` / `DATABASE_URL_AIVEN` variables as needed.

3. No custom build command is required; Vercel serves `index.html` from the repository root and routes `/api/*` requests to the serverless function in `api/[...path].js`. Do not set `PORT`; Vercel assigns function ports automatically.
4. Once the project is deployed, open the site and sign in with the configured Owner account.

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
