// npm i express pg cors dotenv
import express from "express";
import pg from "pg";
import cors from "cors";
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { AsyncLocalStorage } from "node:async_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import "dotenv/config";
import { getDatabaseConfig } from "./database-config.js";

const app = express();
const indexFile = fileURLToPath(new URL("./index.html", import.meta.url));
const poolKey = Symbol.for("hardwareops.postgresPool");
const authSchemaKey = Symbol.for("hardwareops.authSchemaInitialization");
const financeSchemaKey = Symbol.for("hardwareops.financeSchemaInitialization");
const requestContext = new AsyncLocalStorage();
app.use(cors());
app.use(express.json());
app.use((req, _res, next) => {
  const requestId = req.get("x-vercel-id") || req.get("x-request-id") || randomUUID();
  req.requestId = requestId;
  requestContext.run({
    endpoint: req.originalUrl.split("?")[0],
    method: req.method,
    requestId
  }, next);
});
app.get("/", (_req, res) => res.sendFile(indexFile));
const scrypt = promisify(scryptCallback);

function logPoolExhaustion(error, req, source = "request") {
  if (error?.code !== "53300") return;
  const context = requestContext.getStore();
  const pool = globalThis[poolKey];
  console.error(JSON.stringify({
    event: "postgres_pool_exhaustion",
    code: error.code,
    source,
    endpoint: req?.originalUrl?.split("?")[0] || context?.endpoint || "unknown",
    method: req?.method || context?.method || "unknown",
    requestId: req?.requestId || context?.requestId || null,
    pool: {
      totalCount: pool?.totalCount ?? 0,
      idleCount: pool?.idleCount ?? 0,
      waitingCount: pool?.waitingCount ?? 0
    }
  }));
}

function getPool() {
  if (!globalThis[poolKey]) {
    const configuredMax = Number(process.env.PG_POOL_MAX ?? 1);
    if (!Number.isSafeInteger(configuredMax) || configuredMax < 1) {
      throw new Error("PG_POOL_MAX must be a positive integer.");
    }
    const pool = new pg.Pool({
      ...getDatabaseConfig(),
      max: configuredMax,
      idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 10000,
      allowExitOnIdle: true
    });
    pool.on("error", error => logPoolExhaustion(error, undefined, "pool"));
    globalThis[poolKey] = pool;
  }
  return globalThis[poolKey];
}

const q = async (text, params) => {
  return getPool().query(text, params);
};

async function connectDb() {
  return getPool().connect();
}

function ensureAuthSchema() {
  return initializeAuthSchema();
}

function handleDatabaseBusy(error, req, res, source) {
  if (error?.code !== "53300") return false;
  logPoolExhaustion(error, req, source);
  res.set("Retry-After", "2").status(503).json({ error: "database_busy" });
  return true;
}

app.use("/api", (req, res, next) => {
  Promise.all([ensureAuthSchema(), initializeFinanceSchema()]).then(() => next()).catch(error => {
    if (handleDatabaseBusy(error, req, res, "initializeAuthSchema")) return;
    console.error("Failed to initialize HardwareOps API:", error);
    res.status(500).json({ error: "The API could not connect to its database." });
  });
});

/* ---------- helpers ---------- */
const wrap = (fn, source = "request") => (req, res) =>
  fn(req, res).catch(err => {
    if (handleDatabaseBusy(err, req, res, source)) return;
    console.error(err);
    if (err.code === "P0001" && /period is locked/i.test(err.message || "")) {
      return res.status(422).json({ error: err.message });
    }
    if (err.code === "P0001" && /journal entry|journal line/i.test(err.message || "")) {
      return res.status(400).json({ error: err.message });
    }
    if (err.code === "23505") {
      return res.status(409).json({ error: "A record with that identifier already exists." });
    }
    if (["22007", "22008", "22023", "22P02", "23502", "23503", "23514"].includes(err.code)) {
      return res.status(400).json({ error: "The supplied finance values are invalid." });
    }
    res.status(500).json({ error: err.message });
  });

/* ============================================================
   USERS & AUTH
   ============================================================ */
const hashSessionToken = token => createHash("sha256").update(token).digest("hex");

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${hash.toString("hex")}`;
}

async function verifyPassword(password, storedHash) {
  const [algorithm, salt, hashHex] = (storedHash || "").split("$");
  if (algorithm !== "scrypt" || !salt || !/^[a-f0-9]{128}$/i.test(hashHex || "")) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, salt, expected.length);
  return timingSafeEqual(expected, actual);
}

function bearerToken(req) {
  const match = /^Bearer\s+(.+)$/i.exec(req.get("authorization") || "");
  return match?.[1] || null;
}

async function requireAuth(req, res, next) {
  try {
    const token = bearerToken(req);
    if (!token) return res.status(401).json({ error: "Authentication required" });
    const { rows } = await q(`
      SELECT s.token_hash, u.id, u.name, u.init, u.email, u.role_key AS role
      FROM auth_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > NOW() AND u.active`,
    [hashSessionToken(token)]);
    if (!rows.length) return res.status(401).json({ error: "Session expired or invalid" });
    req.user = rows[0];
    next();
  } catch (err) {
    if (handleDatabaseBusy(err, req, res, "requireAuth")) return;
    console.error("Authentication lookup failed:", err);
    res.status(500).json({ error: "Authentication service unavailable" });
  }
}

app.post("/api/login", wrap(async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = req.body?.password;
  if (!email || typeof password !== "string" || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }
  const { rows } = await q(`
    SELECT id, password_hash FROM users
    WHERE lower(email) = $1 AND active`,
  [email]);
  if (!rows.length || !await verifyPassword(password, rows[0].password_hash)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const token = randomBytes(32).toString("base64url");
  await q(`
    INSERT INTO auth_sessions (token_hash, user_id, expires_at)
    VALUES ($1, $2, NOW() + INTERVAL '12 hours')`,
  [hashSessionToken(token), rows[0].id]);
  res.json({ token });
}, "login"));

app.post("/api/logout", wrap(async (req, res) => {
  const token = bearerToken(req);
  if (token) await q(`DELETE FROM auth_sessions WHERE token_hash = $1`, [hashSessionToken(token)]);
  res.json({ ok: true });
}));

app.use("/api", requireAuth);

function requireFinancePermission(permKey, fallbackMessage) {
  return async (req, res, next) => {
    try {
      const { rows } = await q(`
        SELECT granted FROM role_permissions
        WHERE role_key = $1 AND perm_key = $2`,
      [req.user.role, permKey]);
      if (!rows[0]?.granted) {
        return res.status(403).json({ error: fallbackMessage });
      }
      next();
    } catch (err) {
      if (handleDatabaseBusy(err, req, res, "requireFinancePermission")) return;
      console.error("Finance permission lookup failed:", err);
      res.status(500).json({ error: "Unable to verify finance permissions." });
    }
  };
}

const requireFinance = requireFinancePermission("finance", "Finance access is not permitted for this role.");
const requireFinanceEdit = requireFinancePermission("finance_edit", "Finance editing is not permitted for this role.");

async function requireMasterEdit(req, res, next) {
  try {
    const { rows } = await q(`
      SELECT granted FROM role_permissions
      WHERE role_key = $1 AND perm_key = 'masters_edit'`,
    [req.user.role]);
    if (!rows[0]?.granted) return res.status(403).json({ error: "Master data editing is not permitted for this role." });
    next();
  } catch (err) {
    if (handleDatabaseBusy(err, req, res, "requireMasterEdit")) return;
    console.error("Master edit permission lookup failed:", err);
    res.status(500).json({ error: "Unable to verify master data permissions." });
  }
}

async function requireUserManage(req, res, next) {
  try {
    const { rows } = await q(`
      SELECT granted FROM role_permissions
      WHERE role_key = $1 AND perm_key = 'users_manage'`,
    [req.user.role]);
    if (!rows[0]?.granted) return res.status(403).json({ error: "User management is not permitted for this role." });
    next();
  } catch (err) {
    if (handleDatabaseBusy(err, req, res, "requireUserManage")) return;
    console.error("User management permission lookup failed:", err);
    res.status(500).json({ error: "Unable to verify user management permissions." });
  }
}

app.get("/api/me", wrap(async (req, res) => {
  res.json(req.user);
}));

app.get("/api/users", (req, res, next) =>
  req.query.includeInactive === "true" ? requireUserManage(req, res, next) : next(),
wrap(async (req, res) => {
  const { rows } = await q(`
    SELECT u.id, u.name, u.init, u.email, u.role_key AS role, r.color, u.active
    FROM users u JOIN roles r ON r.role_key = u.role_key
    WHERE u.active OR $1 ORDER BY u.id`,
  [req.query.includeInactive === "true"]);
  res.json(rows);
}));

app.get("/api/users/:id", wrap(async (req, res) => {
  const { rows } = await q(`
    SELECT u.id, u.name, u.init, u.email, u.role_key AS role, r.color, r.description
    FROM users u JOIN roles r ON r.role_key = u.role_key WHERE u.id = $1`, [req.params.id]);
  res.json(rows[0] || null);
}));

app.post("/api/users", requireUserManage, wrap(async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const role = String(req.body?.role || "").trim();
  const password = req.body?.password;
  if (!name || !email || !role || typeof password !== "string") {
    return res.status(400).json({ error: "Name, email, role, and password are required." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }
  if (password.length < 12) {
    return res.status(400).json({ error: "Password must be at least 12 characters." });
  }

  const init = name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join("");
  try {
    const { rows } = await q(`
      INSERT INTO users (name, init, email, role_key, password_hash)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, name, init, email, role_key AS role, active`,
    [name, init, email, role, await hashPassword(password)]);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "An account with that email already exists." });
    if (err.code === "23503") return res.status(400).json({ error: "Select a valid user role." });
    throw err;
  }
}));

app.put("/api/users/:id", requireUserManage, wrap(async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const role = String(req.body?.role || "").trim();
  if (!name || !email || !role) {
    return res.status(400).json({ error: "Name, email, and role are required." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }
  const init = name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join("");
  const client = await connectDb();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [7319421]);
    const { rows: current } = await client.query(
      `SELECT role_key, active FROM users WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (!current.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "User not found." });
    }
    if (current[0].active && current[0].role_key === "Owner" && role !== "Owner") {
      const { rows: owners } = await client.query(`
        SELECT COUNT(*)::INTEGER AS count FROM users
        WHERE active AND role_key = 'Owner'`);
      if (owners[0].count <= 1) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "The last active Owner cannot be assigned another role." });
      }
    }
    const { rows } = await client.query(`
      UPDATE users SET name = $1, init = $2, email = $3, role_key = $4
      WHERE id = $5
      RETURNING id, name, init, email, role_key AS role, active`,
    [name, init, email, role, req.params.id]);
    await client.query("COMMIT");
    res.json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505") return res.status(409).json({ error: "An account with that email already exists." });
    if (err.code === "23503") return res.status(400).json({ error: "Select a valid user role." });
    throw err;
  } finally {
    client.release();
  }
}));

async function setUserActive(userId, active) {
  const client = await connectDb();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [7319421]);
    if (!active) {
      const { rows: target } = await client.query(
        `SELECT role_key FROM users WHERE id = $1 AND active FOR UPDATE`,
        [userId]
      );
      if (!target.length) {
        const error = new Error("Active user not found.");
        error.status = 404;
        throw error;
      }
      if (target[0].role_key === "Owner") {
        const { rows: owners } = await client.query(`
          SELECT COUNT(*)::INTEGER AS count FROM users
          WHERE active AND role_key = 'Owner'`);
        if (owners[0].count <= 1) {
          const error = new Error("The last active Owner account cannot be deactivated.");
          error.status = 409;
          throw error;
        }
      }
      await client.query(`DELETE FROM auth_sessions WHERE user_id = $1`, [userId]);
    }
    const { rows } = await client.query(`
      UPDATE users SET active = $1 WHERE id = $2
      RETURNING id, name, init, email, role_key AS role, active`,
    [active, userId]);
    if (!rows.length) {
      const error = new Error("User not found.");
      error.status = 404;
      throw error;
    }
    await client.query("COMMIT");
    return rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

app.put("/api/users/:id/status", requireUserManage, wrap(async (req, res) => {
  const active = req.body?.active;
  if (typeof active !== "boolean") {
    return res.status(400).json({ error: "Active status must be true or false." });
  }
  if (!active && Number(req.params.id) === req.user.id) {
    return res.status(400).json({ error: "You cannot deactivate your own account." });
  }
  try {
    res.json(await setUserActive(req.params.id, active));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }
}));

app.delete("/api/users/:id", requireUserManage, wrap(async (req, res) => {
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ error: "You cannot deactivate your own account." });
  }
  try {
    res.json(await setUserActive(req.params.id, false));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }
}));

app.put("/api/users/:id/password", wrap(async (req, res) => {
  const password = req.body?.password;
  if (req.user.role !== "Owner") return res.status(403).json({ error: "Only the Owner can set account passwords" });
  if (typeof password !== "string" || password.length < 12) {
    return res.status(400).json({ error: "Password must be at least 12 characters" });
  }
  const { rows } = await q(`
    WITH updated AS (
      UPDATE users SET password_hash = $1 WHERE id = $2 AND active RETURNING id
    ), revoked AS (
      DELETE FROM auth_sessions s USING updated u
      WHERE s.user_id = u.id AND s.token_hash <> $3
    )
    SELECT id FROM updated`,
  [await hashPassword(password), req.params.id, req.user.token_hash]);
  if (!rows.length) return res.status(404).json({ error: "Active user not found" });
  res.json({ ok: true });
}));

app.get("/api/permissions", wrap(async (_req, res) => {
  const { rows } = await q(`SELECT role_key, perm_key, granted FROM role_permissions`);
  const map = {};
  rows.forEach(r => {
    map[r.role_key] ??= {};
    map[r.role_key][r.perm_key] = r.granted;
  });
  res.json(map);
}));

app.get("/api/finance/accounts", requireFinance, wrap(async (_req, res) => {
  const { rows } = await q(`
    SELECT code, name, account_type AS type, parent_code, postable, contra
    FROM chart_of_accounts
    ORDER BY code`);
  res.json(rows);
}));

app.get("/api/finance/journal", requireFinance, wrap(async (req, res) => {
  const { from, to, source, account } = req.query;
  const { rows } = await q(`
    SELECT je.id, je.entry_date AS date, je.description, je.source, je.ref,
           jl.id AS line_id, jl.account_code, jl.debit, jl.credit, je.created_by
    FROM journal_entries je
    LEFT JOIN journal_lines jl ON jl.je_id = je.id
    WHERE ($1::DATE IS NULL OR je.entry_date >= $1)
      AND ($2::DATE IS NULL OR je.entry_date <= $2)
      AND ($3::TEXT IS NULL OR je.source = $3)
      AND ($4::TEXT IS NULL OR jl.account_code = $4)
    ORDER BY je.entry_date DESC, je.id DESC, jl.account_code`,
    [from || null, to || null, source || null, account || null]);
  res.json(rows);
}));

app.post("/api/finance/journal", requireFinanceEdit, wrap(async (req, res) => {
  const { date, description, source = "Manual", ref, lines } = req.body || {};
  if (!date || !Array.isArray(lines) || !lines.length) {
    return res.status(400).json({ error: "A journal date and at least one line are required." });
  }
  const { rows } = await q(`
    SELECT fn_post_journal($1, $2, $3, $4, $5::jsonb, $6) AS id`,
    [date, description || "Manual journal", source, ref || null, JSON.stringify(lines), req.user.id]
  );
  res.json({ id: rows[0].id });
}));

app.get("/api/finance/ledger/:account", requireFinance, wrap(async (req, res) => {
  const { rows } = await q(`
    SELECT je.entry_date AS date, je.description, je.source, jl.debit, jl.credit
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.je_id
    WHERE jl.account_code = $1
    ORDER BY je.entry_date DESC, je.id DESC`,
  [req.params.account]);
  res.json(rows);
}));

app.get("/api/finance/trial-balance", requireFinance, wrap(async (_req, res) => {
  const { rows } = await q(`
    SELECT coa.code, coa.name, coa.account_type AS type,
           COALESCE(SUM(jl.debit), 0) AS debit,
           COALESCE(SUM(jl.credit), 0) AS credit,
           COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0) AS balance
    FROM chart_of_accounts coa
    LEFT JOIN journal_lines jl ON jl.account_code = coa.code
    GROUP BY coa.code, coa.name, coa.account_type
    ORDER BY coa.code`);
  res.json(rows);
}));

app.get("/api/finance/pnl", requireFinance, wrap(async (_req, res) => {
  const { rows } = await q(`
    SELECT
      COALESCE(SUM(CASE WHEN coa.account_type = 'Revenue' THEN jl.credit - jl.debit ELSE 0 END),0) AS revenue,
      COALESCE(SUM(CASE WHEN coa.account_type = 'COGS' THEN jl.debit - jl.credit ELSE 0 END),0) AS cogs,
      COALESCE(SUM(CASE WHEN coa.account_type = 'Expense' THEN jl.debit - jl.credit ELSE 0 END),0) AS expenses,
      COALESCE(SUM(CASE WHEN coa.account_type = 'Revenue' THEN jl.credit - jl.debit
                       WHEN coa.account_type = 'COGS' THEN jl.debit - jl.credit
                       WHEN coa.account_type = 'Expense' THEN jl.debit - jl.credit
                       ELSE 0 END),0) AS net_profit
    FROM journal_lines jl
    JOIN chart_of_accounts coa ON coa.code = jl.account_code`);
  res.json(rows[0]);
}));

app.get("/api/finance/balance-sheet", requireFinance, wrap(async (_req, res) => {
  const { rows } = await q(`
    SELECT
      COALESCE(SUM(CASE WHEN coa.account_type = 'Asset' THEN jl.debit - jl.credit ELSE 0 END),0) AS assets,
      COALESCE(SUM(CASE WHEN coa.account_type = 'Liability' THEN jl.credit - jl.debit ELSE 0 END),0) AS liabilities,
      COALESCE(SUM(CASE WHEN coa.account_type = 'Equity' THEN jl.credit - jl.debit ELSE 0 END),0)
      + COALESCE(SUM(CASE WHEN coa.account_type = 'Revenue' THEN jl.credit - jl.debit
                          WHEN coa.account_type IN ('COGS','Expense') THEN jl.credit - jl.debit
                          ELSE 0 END),0) AS equity
    FROM journal_lines jl
    JOIN chart_of_accounts coa ON coa.code = jl.account_code`);
  res.json(rows[0]);
}));

app.get("/api/finance/cash-flow", requireFinance, wrap(async (req, res) => {
  const { from, to } = req.query;
  const { rows } = await q(`
    SELECT
      COALESCE(SUM(CASE WHEN jl.account_code IN ('1100','1110') THEN jl.debit - jl.credit ELSE 0 END),0) AS cash_inflow,
      COALESCE(SUM(CASE WHEN jl.account_code IN ('1100','1110') THEN jl.credit - jl.debit ELSE 0 END),0) AS cash_outflow
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.je_id
    WHERE ($1::DATE IS NULL OR je.entry_date >= $1)
      AND ($2::DATE IS NULL OR je.entry_date <= $2)`,
  [from || null, to || null]);
  res.json(rows[0]);
}));

app.get("/api/finance/aging/ar", requireFinance, wrap(async (_req, res) => {
  const { rows } = await q(`
    SELECT i.id, i.customer_id, c.name AS customer, i.total, i.amount_paid,
           (i.total - i.amount_paid) AS outstanding,
           i.due_date,
           CASE
             WHEN i.status = 'Paid' THEN 'Current'
             WHEN i.due_date >= CURRENT_DATE THEN 'Current'
             WHEN i.due_date >= CURRENT_DATE - INTERVAL '30 days' THEN '1-30'
             WHEN i.due_date >= CURRENT_DATE - INTERVAL '60 days' THEN '31-60'
             WHEN i.due_date >= CURRENT_DATE - INTERVAL '90 days' THEN '61-90'
             ELSE '90+'
           END AS bucket
    FROM invoices i
    JOIN customers c ON c.id = i.customer_id
    WHERE i.status NOT IN ('Paid', 'Cancelled')
      AND i.total > i.amount_paid
    ORDER BY i.due_date`);
  res.json(rows);
}));

app.post("/api/finance/aging/ar/:invoiceId/receive", requireFinanceEdit, wrap(async (req, res) => {
  const requestedAmount = req.body?.amount;
  if (requestedAmount !== undefined && (!Number.isFinite(Number(requestedAmount)) || Number(requestedAmount) <= 0)) {
    return res.status(400).json({ error: "Receipt amount must be greater than zero." });
  }
  const client = await connectDb();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(`
      SELECT id, customer_id, total, amount_paid, status FROM invoices
      WHERE id = $1 FOR UPDATE`,
    [req.params.invoiceId]);
    if (!rows.length || rows[0].status === "Paid" || rows[0].status === "Cancelled") {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Open invoice not found." });
    }
    const outstanding = Number(rows[0].total) - Number(rows[0].amount_paid);
    const amount = requestedAmount === undefined ? outstanding : Number(requestedAmount);
    if (amount > outstanding) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Receipt amount exceeds the invoice balance." });
    }
    const remaining = outstanding - amount;
    await client.query(`
      UPDATE invoices SET amount_paid = amount_paid + $2,
        status = CASE WHEN amount_paid + $2 >= total THEN 'Paid' ELSE 'Partial' END
      WHERE id = $1`,
    [req.params.invoiceId, amount]);
    await client.query(`
      UPDATE customers SET credit_used = GREATEST(credit_used - $2, 0)
      WHERE id = $1`,
    [rows[0].customer_id, amount]);
    await client.query("COMMIT");
    res.json({ ok: true, id: req.params.invoiceId, received: amount, outstanding: remaining });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}));

app.get("/api/finance/aging/ap", requireFinance, wrap(async (_req, res) => {
  const { rows } = await q(`
    SELECT g.id, g.supplier_id, s.name AS supplier, g.date_received,
           ROUND(COALESCE(SUM(gl.qty * gl.cost),0),2)
             + ROUND(COALESCE(SUM(gl.qty * gl.cost * COALESCE(t.rate, 0) / 100),0),2) AS total,
           g.amount_paid,
           GREATEST(ROUND(COALESCE(SUM(gl.qty * gl.cost),0),2)
             + ROUND(COALESCE(SUM(gl.qty * gl.cost * COALESCE(t.rate, 0) / 100),0),2) - g.amount_paid, 0) AS outstanding,
           CASE WHEN g.date_received >= CURRENT_DATE THEN 'Current'
                WHEN g.date_received >= CURRENT_DATE - INTERVAL '30 days' THEN '1-30'
                WHEN g.date_received >= CURRENT_DATE - INTERVAL '60 days' THEN '31-60'
                WHEN g.date_received >= CURRENT_DATE - INTERVAL '90 days' THEN '61-90'
                ELSE '90+' END AS bucket
    FROM grns g
    LEFT JOIN grn_lines gl ON gl.grn_id = g.id
    LEFT JOIN items i ON i.sku = gl.sku
    LEFT JOIN tax_codes t ON t.code = i.tax_code
    LEFT JOIN suppliers s ON s.id = g.supplier_id
    WHERE g.paid = FALSE
    GROUP BY g.id, g.supplier_id, s.name, g.date_received, g.amount_paid
    ORDER BY g.date_received DESC`);
  res.json(rows);
}));

app.post("/api/finance/aging/ap/:grnId/pay", requireFinanceEdit, wrap(async (req, res) => {
  const requestedAmount = req.body?.amount;
  if (requestedAmount !== undefined && (!Number.isFinite(Number(requestedAmount)) || Number(requestedAmount) <= 0)) {
    return res.status(400).json({ error: "Payment amount must be greater than zero." });
  }
  const client = await connectDb();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(`
      SELECT id, amount_paid FROM grns
      WHERE id = $1 FOR UPDATE`,
    [req.params.grnId]);
    if (!rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "GRN not found." });
    }
    const { rows: totals } = await client.query(`
      SELECT ROUND(COALESCE(SUM(gl.qty * gl.cost),0),2)
               + ROUND(COALESCE(SUM(gl.qty * gl.cost * COALESCE(t.rate, 0) / 100),0),2) AS total
      FROM grn_lines gl
      JOIN items i ON i.sku = gl.sku
      LEFT JOIN tax_codes t ON t.code = i.tax_code
      WHERE gl.grn_id = $1`,
    [req.params.grnId]);
    const total = Number(totals[0].total);
    const outstanding = total - Number(rows[0].amount_paid);
    if (outstanding <= 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "GRN has no outstanding balance." });
    }
    const amount = requestedAmount === undefined ? outstanding : Number(requestedAmount);
    if (amount > outstanding) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Payment amount exceeds the payable balance." });
    }
    const remaining = outstanding - amount;
    await client.query(`
      UPDATE grns SET amount_paid = amount_paid + $2,
        paid = amount_paid + $2 >= $3
      WHERE id = $1`,
    [req.params.grnId, amount, total]);
    await client.query(`
      SELECT fn_post_journal(CURRENT_DATE, 'AP payment ' || $1, 'AP', $1,
        $2::jsonb, $3)`,
    [req.params.grnId, JSON.stringify([
      { account_code: '2100', debit: amount, credit: 0 },
      { account_code: '1100', debit: 0, credit: amount }
    ]), req.user.id]);
    await client.query("COMMIT");
    res.json({ ok: true, id: req.params.grnId, paid: amount, outstanding: remaining });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}));

app.get("/api/finance/expenses", requireFinance, wrap(async (_req, res) => {
  const { rows } = await q(`SELECT * FROM expenses ORDER BY expense_date DESC, id DESC`);
  res.json(rows);
}));

app.get("/api/finance/expense-categories", requireFinance, wrap(async (_req, res) => {
  const { rows } = await q(`
    SELECT code, name, account_code
    FROM expense_categories
    ORDER BY code`);
  res.json(rows);
}));

app.post("/api/finance/expenses", requireFinanceEdit, wrap(async (req, res) => {
  const { category_code, expense_date, amount: rawAmount, vendor, notes } = req.body || {};
  const amount = Number(rawAmount);
  if (!expense_date || !category_code || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "Expense date, category, and amount are required." });
  }
  const client = await connectDb();
  try {
    await client.query("BEGIN");
    const { rows: [{ voucher_id: voucherId }] } = await client.query(
      `SELECT fn_next_number('EXP') AS voucher_id`
    );
    await client.query(`
      INSERT INTO expenses (id, category_code, expense_date, amount, vendor, notes, posted, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7)`,
    [voucherId, category_code, expense_date, amount, vendor || null, notes || null, req.user.id]);
    await client.query("COMMIT");
    res.json({ id: voucherId });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}));

app.get("/api/finance/vat-return", requireFinance, wrap(async (req, res) => {
  const { from, to } = req.query;
  const { rows } = await q(`
    SELECT
      COALESCE(SUM(CASE WHEN jl.account_code = '2200' THEN jl.credit - jl.debit ELSE 0 END),0) AS output_vat,
      COALESCE(SUM(CASE WHEN jl.account_code = '2210' THEN jl.debit - jl.credit ELSE 0 END),0) AS input_vat,
      COALESCE(SUM(CASE WHEN jl.account_code = '2200' THEN jl.credit - jl.debit ELSE 0 END),0)
      - COALESCE(SUM(CASE WHEN jl.account_code = '2210' THEN jl.debit - jl.credit ELSE 0 END),0) AS net_vat
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.je_id
    WHERE ($1::DATE IS NULL OR je.entry_date >= $1)
      AND ($2::DATE IS NULL OR je.entry_date <= $2)`,
  [from || null, to || null]);
  res.json(rows[0]);
}));

app.get("/api/finance/fixed-assets", requireFinance, wrap(async (_req, res) => {
  const { rows } = await q(`SELECT * FROM fixed_assets ORDER BY id`);
  res.json(rows);
}));

app.post("/api/finance/fixed-assets", requireFinanceEdit, wrap(async (req, res) => {
  const { code, name, cost: rawCost, life_years: rawLife, salvage: rawSalvage = 0 } = req.body || {};
  const cost = Number(rawCost);
  const lifeYears = Number(rawLife);
  const salvage = Number(rawSalvage);
  if (!code || !name || !Number.isFinite(cost) || cost <= 0
      || !Number.isSafeInteger(lifeYears) || lifeYears <= 0
      || !Number.isFinite(salvage) || salvage < 0 || salvage > cost) {
    return res.status(400).json({ error: "Enter a valid asset code, name, cost, useful life, and salvage value." });
  }
  const client = await connectDb();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(`
      INSERT INTO fixed_assets (code, name, cost, life_years, salvage)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *`,
    [code, name, cost, lifeYears, salvage]);
    await client.query(`
      SELECT fn_post_journal(CURRENT_DATE, 'Fixed asset acquisition ' || $1, 'ASSET', $1,
        $2::jsonb, $3)`,
    [code, JSON.stringify([
      { account_code: '1500', debit: cost, credit: 0 },
      { account_code: '1100', debit: 0, credit: cost }
    ]), req.user.id]);
    await client.query("COMMIT");
    res.json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}));

app.post("/api/finance/fixed-assets/depreciate", requireFinanceEdit, wrap(async (req, res) => {
  const { period } = req.body || {};
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(period || ""))) {
    return res.status(400).json({ error: "Period must use YYYY-MM format." });
  }
  const client = await connectDb();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`finance:depreciation:${period}`]);
    const { rows: existing } = await client.query(`
      SELECT id FROM journal_entries
      WHERE ref = $1 AND source = 'Depreciation' LIMIT 1`,
    [period]);
    if (existing.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Depreciation has already been posted for this period." });
    }
    const { rows: assets } = await client.query(`
      SELECT id, GREATEST(LEAST(
        ROUND((cost - salvage) / (GREATEST(life_years, 1)::NUMERIC * 12), 2),
        cost - salvage - accumulated_depreciation
      ), 0) AS amount
      FROM fixed_assets
      WHERE active = TRUE
      FOR UPDATE`);
    const centsByAsset = assets.map(asset => Math.max(0, Math.round(Number(asset.amount) * 100)));
    const totalCents = centsByAsset.reduce((sum, cents) => sum + cents, 0);
    if (!totalCents) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "No depreciation to post." });
    }
    const total = totalCents / 100;
    await client.query(`
      SELECT fn_post_journal($1, 'Fixed asset depreciation', 'Depreciation', $2,
        $3::jsonb, $4)`,
    [`${period}-01`, period, JSON.stringify([
      { account_code: '6500', debit: total, credit: 0 },
      { account_code: '1690', debit: 0, credit: total }
    ]), req.user.id]);
    for (let index = 0; index < assets.length; index++) {
      if (!centsByAsset[index]) continue;
      await client.query(`
        UPDATE fixed_assets
        SET accumulated_depreciation = accumulated_depreciation + $2
        WHERE id = $1`,
      [assets[index].id, centsByAsset[index] / 100]);
    }
    await client.query("COMMIT");
    res.json({ period, posted: total });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}));

app.get("/api/finance/budgets", requireFinance, wrap(async (_req, res) => {
  const { rows } = await q(`SELECT * FROM budgets ORDER BY period DESC, account_code`);
  res.json(rows);
}));

app.put("/api/finance/budgets/:period/:code", requireFinanceEdit, wrap(async (req, res) => {
  const amount = Number(req.body?.amount ?? 0);
  const { rows } = await q(`
    INSERT INTO budgets (period, account_code, amount)
    VALUES ($1, $2, $3)
    ON CONFLICT (period, account_code)
    DO UPDATE SET amount = EXCLUDED.amount
    RETURNING *`,
  [req.params.period, req.params.code, amount]);
  res.json(rows[0]);
}));

app.get("/api/finance/period-lock", requireFinance, wrap(async (_req, res) => {
  const { rows } = await q(`SELECT * FROM period_locks ORDER BY lock_through_date DESC`);
  res.json(rows);
}));

app.post("/api/finance/period-lock", requireFinanceEdit, wrap(async (req, res) => {
  const { lock_through_date } = req.body || {};
  if (!lock_through_date) return res.status(400).json({ error: "lock_through_date is required." });
  const client = await connectDb();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(7319422)`);
    const { rows } = await client.query(`
      INSERT INTO period_locks (lock_through_date, created_by)
      VALUES ($1, $2)
      ON CONFLICT (lock_through_date)
      DO UPDATE SET created_by = EXCLUDED.created_by
      RETURNING *`,
    [lock_through_date, req.user.id]);
    await client.query("COMMIT");
    res.json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}));

app.get("/api/finance/bank-recon", requireFinance, wrap(async (_req, res) => {
  const { rows } = await q(`
    SELECT br.id, br.je_line_id, br.reconciled_at, br.reconciled_by,
           jl.account_code, jl.debit, jl.credit
    FROM bank_reconciliations br
    JOIN journal_lines jl ON jl.id = br.je_line_id
    ORDER BY br.reconciled_at DESC`);
  res.json(rows);
}));

app.post("/api/finance/bank-recon/:jeLineId", requireFinanceEdit, wrap(async (req, res) => {
  const { rows } = await q(`
    INSERT INTO bank_reconciliations (je_line_id, reconciled_by)
    SELECT jl.id, $2 FROM journal_lines jl
    WHERE jl.id = $1 AND jl.account_code IN ('1100','1110')
    ON CONFLICT (je_line_id) DO NOTHING
    RETURNING *`,
  [req.params.jeLineId, req.user.id]);
  if (!rows.length) {
    const { rows: existing } = await q(`
      SELECT id FROM bank_reconciliations WHERE je_line_id = $1`,
    [req.params.jeLineId]);
    if (existing.length) return res.status(409).json({ error: "Journal line is already reconciled." });
    return res.status(404).json({ error: "Cash or bank journal line not found." });
  }
  res.json(rows[0]);
}));

app.put("/api/permissions/:role/:perm", wrap(async (req, res) => {
  const { role, perm } = req.params;
  const { granted } = req.body;
  await q(`UPDATE role_permissions SET granted=$1 WHERE role_key=$2 AND perm_key=$3`,
          [granted, role, perm]);
  res.json({ ok: true });
}));

/* ============================================================
   NUMBER SERIES
   ============================================================ */
app.get("/api/number-series", wrap(async (_req, res) => {
  const { rows } = await q(`SELECT code, prefix, year, next, pad, descr AS "desc" FROM number_series ORDER BY code`);
  res.json(rows);
}));
app.post("/api/number-series/:code/reset", wrap(async (req, res) => {
  await q(`UPDATE number_series SET next=1 WHERE code=$1`, [req.params.code]);
  res.json({ ok: true });
}));
app.post("/api/number-series/:code/advance", wrap(async (req, res) => {
  await q(`UPDATE number_series SET next = next + 1 WHERE code=$1`, [req.params.code]);
  res.json({ ok: true });
}));

/* ============================================================
   MASTERS
   ============================================================ */
const masters = ["suppliers","categories","brands","locations","tax-codes","uoms","price-tiers","payment-terms"];

app.get("/api/suppliers", wrap(async (_req,res)=> res.json((await q(`
  SELECT s.id, s.name, s.city, s.lead_days AS lead, s.terms_code AS terms
  FROM suppliers s ORDER BY s.name`)).rows)));

app.post("/api/suppliers", requireMasterEdit, wrap(async (req,res)=>{
  const { name, city, lead=3, terms } = req.body;
  const { rows } = await q(`INSERT INTO suppliers(name,city,lead_days,terms_code)
    VALUES ($1,$2,$3,$4) RETURNING id,name,city,lead_days AS lead,terms_code AS terms`,
    [name, city, lead, terms]);
  res.json(rows[0]);
}));

app.get("/api/categories", wrap(async (_req,res)=> res.json((await q(`
  SELECT code, name, margin FROM categories ORDER BY code`)).rows)));
app.post("/api/categories", requireMasterEdit, wrap(async (req,res)=>{
  const { code, name, margin=30 } = req.body;
  const { rows } = await q(`INSERT INTO categories(code,name,margin)
    VALUES ($1,$2,$3) RETURNING *`, [code, name, margin]);
  res.json(rows[0]);
}));

app.get("/api/brands", wrap(async (_req,res)=> res.json((await q(`
  SELECT code,name,country, warranty_months AS warranty, distributor AS dist FROM brands ORDER BY name`)).rows)));
app.post("/api/brands", requireMasterEdit, wrap(async (req,res)=>{
  const { code, name, country, warranty=0, dist } = req.body;
  const { rows } = await q(`INSERT INTO brands(code,name,country,warranty_months,distributor)
    VALUES ($1,$2,$3,$4,$5) RETURNING *`, [code,name,country,warranty,dist]);
  res.json(rows[0]);
}));

app.get("/api/tax-codes", wrap(async (_req,res)=> res.json((await q(`
  SELECT code,name,rate, ird AS ird FROM tax_codes ORDER BY code`)).rows)));
app.post("/api/tax-codes", requireMasterEdit, wrap(async (req,res)=>{
  const { code, name, rate=18, ird } = req.body;
  const { rows } = await q(`INSERT INTO tax_codes(code,name,rate,ird)
    VALUES ($1,$2,$3,$4) RETURNING *`, [code,name,rate,ird]);
  res.json(rows[0]);
}));

app.get("/api/uoms", wrap(async (_req,res)=> res.json((await q(`
  SELECT code,name,base_uom AS base, factor, decimals AS dec FROM uoms ORDER BY code`)).rows)));
app.post("/api/uoms", requireMasterEdit, wrap(async (req,res)=>{
  const { code, name, base, factor=1, dec=0 } = req.body;
  const { rows } = await q(`INSERT INTO uoms(code,name,base_uom,factor,decimals)
    VALUES ($1,$2,NULLIF($3,''),$4,$5) RETURNING *`, [code,name,base,factor,dec]);
  res.json(rows[0]);
}));

app.get("/api/locations", wrap(async (_req,res)=> res.json((await q(`
  SELECT code,name,type FROM locations ORDER BY code`)).rows)));
app.post("/api/locations", requireMasterEdit, wrap(async (req,res)=>{
  const { code, name, type } = req.body;
  const { rows } = await q(`INSERT INTO locations(code,name,type) VALUES ($1,$2,$3) RETURNING *`,
    [code,name,type]);
  res.json(rows[0]);
}));

app.get("/api/price-tiers", wrap(async (_req,res)=> res.json((await q(`
  SELECT code,name,disc, applies_to AS applies FROM price_tiers ORDER BY code`)).rows)));
app.post("/api/price-tiers", requireMasterEdit, wrap(async (req,res)=>{
  const { code, name, disc=0, applies } = req.body;
  const { rows } = await q(`INSERT INTO price_tiers(code,name,disc,applies_to)
    VALUES ($1,$2,$3,$4) RETURNING *`, [code,name,disc,applies]);
  res.json(rows[0]);
}));

app.get("/api/payment-terms", wrap(async (_req,res)=> res.json((await q(`
  SELECT code,name,days,disc, cheque FROM payment_terms ORDER BY days`)).rows)));
app.post("/api/payment-terms", requireMasterEdit, wrap(async (req,res)=>{
  const { code, name, days=30, disc=0, cheque="yes" } = req.body;
  const { rows } = await q(`INSERT INTO payment_terms(code,name,days,disc,cheque)
    VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [code,name,days,disc, cheque === "yes" || cheque === true]);
  res.json(rows[0]);
}));

const masterCrud = {
  suppliers: {
    table: "suppliers", key: "id",
    fields: {
      name: { column: "name" }, city: { column: "city", nullable: true },
      lead: { column: "lead_days", number: true }, terms: { column: "terms_code", nullable: true }
    }
  },
  categories: {
    table: "categories", key: "code",
    fields: { name: { column: "name" }, margin: { column: "margin", number: true } }
  },
  items: {
    table: "items", key: "sku",
    fields: {
      name: { column: "name" }, cat: { column: "category_code", nullable: true },
      brand: { column: "brand_code", nullable: true }, uom: { column: "uom_code", nullable: true },
      tax: { column: "tax_code", nullable: true }, cost: { column: "cost", number: true },
      price: { column: "price", number: true }, reorder: { column: "reorder_point", number: true },
      location: { column: "location_code", nullable: true },
      supplier_id: { column: "supplier_id", nullable: true, number: true }
    }
  },
  customers: {
    table: "customers", key: "id",
    fields: {
      name: { column: "name" }, type: { column: "type" },
      tier: { column: "tier_code", nullable: true },
      limit: { column: "credit_limit", number: true },
      terms: { column: "terms_code", nullable: true }
    }
  },
  uoms: {
    table: "uoms", key: "code",
    fields: {
      name: { column: "name" }, base: { column: "base_uom", nullable: true },
      factor: { column: "factor", number: true }, dec: { column: "decimals", number: true }
    }
  },
  "tax-codes": {
    table: "tax_codes", key: "code",
    fields: {
      name: { column: "name" }, rate: { column: "rate", number: true },
      ird: { column: "ird", nullable: true }
    }
  },
  locations: {
    table: "locations", key: "code",
    fields: { name: { column: "name" }, type: { column: "type" } }
  },
  "price-tiers": {
    table: "price_tiers", key: "code",
    fields: {
      name: { column: "name" }, disc: { column: "disc", number: true },
      applies: { column: "applies_to" }
    }
  },
  brands: {
    table: "brands", key: "code",
    fields: {
      name: { column: "name" }, country: { column: "country", nullable: true },
      warranty: { column: "warranty_months", number: true }, dist: { column: "distributor", nullable: true }
    }
  },
  "payment-terms": {
    table: "payment_terms", key: "code",
    fields: {
      name: { column: "name" }, days: { column: "days", number: true },
      disc: { column: "disc", number: true },
      cheque: { column: "cheque", transform: value => value === true || value === "yes" }
    }
  }
};

function masterMutation(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (handleDatabaseBusy(err, req, res, "request")) return;
      logPoolExhaustion(err, req);
      console.error(err);
      if (err.code === "23503") {
        return res.status(409).json({ error: "This record is still in use and cannot be deleted or changed." });
      }
      if (err.code === "23505") {
        return res.status(409).json({ error: "A record with that value already exists." });
      }
      if (["22P02", "23502", "23514"].includes(err.code)) {
        return res.status(400).json({ error: "The supplied master record values are invalid." });
      }
      res.status(500).json({ error: err.message });
    }
  };
}

for (const [resource, definition] of Object.entries(masterCrud)) {
  app.put(`/api/${resource}/:id`, requireMasterEdit, masterMutation(async (req, res) => {
    const updates = Object.entries(definition.fields)
      .filter(([field]) => Object.hasOwn(req.body || {}, field));
    if (!updates.length) {
      return res.status(400).json({ error: "At least one editable field is required." });
    }

    for (const [field, spec] of updates) {
      const raw = req.body[field];
      if (!spec.nullable && (raw === null || raw === undefined || raw === "" ||
          typeof raw === "string" && !raw.trim())) {
        return res.status(400).json({ error: `${field} is required.` });
      }
      if (spec.number && raw !== null && raw !== "" && !Number.isFinite(Number(raw))) {
        return res.status(400).json({ error: `${field} must be a valid number.` });
      }
    }

    const values = updates.map(([field, spec]) => {
      const raw = req.body[field];
      if (raw === "" && spec.nullable) return null;
      return spec.transform ? spec.transform(raw) : spec.number && raw !== null && raw !== ""
        ? Number(raw) : raw;
    });
    const assignments = updates.map(([, spec], index) => `${spec.column} = $${index + 1}`);
    values.push(req.params.id);
    const { rowCount } = await q(
      `UPDATE ${definition.table} SET ${assignments.join(", ")} WHERE ${definition.key} = $${values.length}`,
      values
    );
    if (!rowCount) return res.status(404).json({ error: "Master record not found." });
    res.json({ ok: true });
  }));

  app.delete(`/api/${resource}/:id`, requireMasterEdit, masterMutation(async (req, res) => {
    const { rowCount } = await q(
      `DELETE FROM ${definition.table} WHERE ${definition.key} = $1`,
      [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: "Master record not found." });
    res.json({ ok: true });
  }));
}

app.get("/api/customers", wrap(async (_req,res)=> res.json((await q(`
  SELECT id, name, type, tier_code AS tier, credit_limit AS "limit",
         credit_used AS used, points, terms_code AS terms
  FROM customers ORDER BY id`)).rows)));
app.post("/api/customers", requireMasterEdit, wrap(async (req,res)=>{
  const { name, type, tier, limit=0, terms } = req.body;
  const { rows } = await q(`INSERT INTO customers(name,type,tier_code,credit_limit,terms_code)
    VALUES ($1,$2,$3,$4,$5) RETURNING *`, [name,type,tier,limit,terms]);
  res.json(rows[0]);
}));

/* ============================================================
   INVENTORY / ITEMS
   ============================================================ */
app.get("/api/items", wrap(async (_req,res)=> res.json((await q(`
  SELECT i.sku, i.name, i.category_code AS cat, i.brand_code AS brand,
         i.uom_code AS uom, i.tax_code AS tax, i.cost, i.price,
         i.reorder_point AS reorder, i.location_code AS location,
         i.last_sold, i.supplier_id, s.name AS supplier,
         inv.qty
  FROM items i
  JOIN inventory inv ON inv.sku = i.sku
  LEFT JOIN suppliers s ON s.id = i.supplier_id
  ORDER BY i.sku`)).rows)));

app.post("/api/items", requireMasterEdit, wrap(async (req,res)=>{
  const { sku, name, cat, brand, uom, tax, cost, price, reorder=10, location, supplier_id } = req.body;
  await q(`INSERT INTO items(sku,name,category_code,brand_code,uom_code,tax_code,cost,price,reorder_point,location_code,supplier_id,last_sold)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,CURRENT_DATE)`,
    [sku,name,cat,brand,uom,tax,cost,price,reorder,location,supplier_id]);
  await q(`INSERT INTO inventory(sku,qty) VALUES ($1,0)`, [sku]);
  res.json({ sku });
}));

/* ============================================================
   SALES / POS
   ============================================================ */
app.post("/api/sales", wrap(async (req, res) => {
  const { customer_id, cashier_id, payment, tier, tax_applied, lines } = req.body;
  const client = await connectDb();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT sp_complete_sale($1,$2,$3,$4,$5,$6) AS sale_id`,
      [customer_id || null, cashier_id, payment, tier, tax_applied, JSON.stringify(lines)]
    );
    await client.query(`SELECT fn_post_sale_finance($1, $2)`, [rows[0].sale_id, cashier_id || null]);
    await client.query("COMMIT");
    res.json({ id: rows[0].sale_id });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}));

app.get("/api/sales", wrap(async (req,res)=>{
  const { from, to } = req.query;
  const { rows } = await q(`
    SELECT s.id, s.sale_date AS date, s.sale_time AS time, s.customer_id,
           c.name AS customer, u.name AS cashier, s.tier_code AS tier,
           s.subtotal, s.discount, s.tax, s.total, s.payment_method AS payment,
           s.tax_applied, s.is_return
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN users u ON u.id = s.cashier_id
    WHERE ($1::DATE IS NULL OR s.sale_date >= $1)
      AND ($2::DATE IS NULL OR s.sale_date <= $2)
    ORDER BY s.created_at DESC`, [from || null, to || null]);
  res.json(rows);
}));

app.get("/api/sales/:id/lines", wrap(async (req,res)=>{
  const { rows } = await q(`SELECT sl.sku, i.name, sl.qty, sl.unit_price AS price,
      sl.tax_code AS tax, sl.cost_at_sale AS cost, i.uom_code AS uom
    FROM sale_lines sl JOIN items i ON i.sku = sl.sku WHERE sl.sale_id = $1`, [req.params.id]);
  res.json(rows);
}));

/* ============================================================
   ANALYTICS
   ============================================================ */
function periodRange(period, ref) {
  const d = new Date(ref);
  if (period === "daily") return [d.toISOString().slice(0,10), d.toISOString().slice(0,10)];
  if (period === "weekly") {
    const day = d.getDay();
    const mon = new Date(d); mon.setDate(d.getDate() - ((day+6)%7));
    const sun = new Date(mon); sun.setDate(mon.getDate()+6);
    return [mon.toISOString().slice(0,10), sun.toISOString().slice(0,10)];
  }
  const from = new Date(d.getFullYear(), d.getMonth(), 1);
  const to   = new Date(d.getFullYear(), d.getMonth()+1, 0);
  return [from.toISOString().slice(0,10), to.toISOString().slice(0,10)];
}

app.get("/api/analytics/summary", wrap(async (req,res)=>{
  const [from, to] = periodRange(req.query.period || "weekly", req.query.date || new Date());
  const { rows } = await q(`
    SELECT
      COALESCE(SUM(s.total),0)                                              AS revenue,
      COALESCE(SUM(sl.qty * sl.cost_at_sale),0)                             AS cost,
      COALESCE(SUM(s.total) - SUM(sl.qty * sl.cost_at_sale),0)              AS gross_profit,
      COALESCE(SUM(CASE WHEN s.payment_method='On Account (B2B)' THEN s.total END),0) AS credit_sales,
      COALESCE(SUM(CASE WHEN s.payment_method<>'On Account (B2B)' THEN s.total END),0) AS cash_sales,
      COALESCE(SUM(sl.qty),0)                                               AS items_sold,
      COUNT(DISTINCT s.id)                                                  AS transactions
    FROM sales s
    LEFT JOIN sale_lines sl ON sl.sale_id = s.id
    WHERE s.sale_date BETWEEN $1 AND $2`, [from, to]);
  res.json({ range: { from, to }, ...rows[0] });
}));

app.get("/api/analytics/items", wrap(async (req,res)=>{
  const [from, to] = periodRange(req.query.period || "weekly", req.query.date || new Date());
  const { rows } = await q(`
    SELECT sl.sku, i.name, i.uom_code AS uom,
           SUM(sl.qty) AS qty,
           SUM(sl.qty * sl.unit_price) AS revenue,
           SUM(sl.qty * sl.cost_at_sale) AS cost,
           SUM(sl.qty * (sl.unit_price - sl.cost_at_sale)) AS gross_profit
    FROM sale_lines sl
    JOIN sales s ON s.id = sl.sale_id
    JOIN items i ON i.sku = sl.sku
    WHERE s.sale_date BETWEEN $1 AND $2 AND s.is_return = FALSE
    GROUP BY sl.sku, i.name, i.uom_code
    ORDER BY revenue DESC`, [from, to]);
  res.json(rows);
}));

app.get("/api/analytics/cash-credit", wrap(async (req,res)=>{
  const [from, to] = periodRange(req.query.period || "weekly", req.query.date || new Date());
  const { rows } = await q(`
    SELECT s.id, s.sale_date AS date, COALESCE(c.name,'Walk-in') AS customer,
           s.payment_method AS payment, s.total,
           (SELECT SUM(qty) FROM sale_lines WHERE sale_id = s.id) AS items
    FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
    WHERE s.sale_date BETWEEN $1 AND $2
    ORDER BY s.sale_date DESC`, [from, to]);
  res.json(rows);
}));

app.get("/api/analytics/customer-credit", wrap(async (_req,res)=>{
  const { rows } = await q(`SELECT * FROM v_customer_credit ORDER BY name`);
  res.json(rows);
}));

app.get("/api/analytics/supplier-purchases", wrap(async (_req,res)=>{
  const { rows } = await q(`SELECT * FROM v_supplier_purchases ORDER BY total_value DESC`);
  res.json(rows);
}));

app.get("/api/analytics/gmroi", wrap(async (_req,res)=>{
  const { rows } = await q(`SELECT * FROM v_gmroi_category ORDER BY gmroi DESC`);
  res.json(rows);
}));

/* ============================================================
   PURCHASE ORDERS & GRN
   ============================================================ */
app.get("/api/purchase-orders", wrap(async (_req,res)=>{
  const { rows } = await q(`
    SELECT po.id, po.order_date AS date, po.status,
           po.expected_date AS expected, po.received_date AS received,
           s.id AS supplier_id, s.name AS supplier,
           COALESCE(JSON_AGG(JSON_BUILD_OBJECT('sku',pl.sku,'qty',pl.qty,'cost',pl.cost))
             FILTER (WHERE pl.id IS NOT NULL),'[]') AS lines
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    LEFT JOIN po_lines pl ON pl.po_id = po.id
    GROUP BY po.id, s.id
    ORDER BY po.order_date DESC`);
  res.json(rows);
}));

app.post("/api/purchase-orders", wrap(async (req,res)=>{
  const { supplier_id, lines, created_by } = req.body;
  const { rows: [{ next_number }] } = await q(`SELECT fn_next_number('PO') AS next_number`);
  const id = next_number;
  const { rows: s } = await q(`SELECT lead_days FROM suppliers WHERE id=$1`, [supplier_id]);
  const expected = new Date(); expected.setDate(expected.getDate() + (s[0]?.lead_days || 3));
  await q(`INSERT INTO purchase_orders(id,supplier_id,order_date,status,expected_date,created_by)
           VALUES ($1,$2,CURRENT_DATE,'Sent',$3,$4)`,
    [id, supplier_id, expected.toISOString().slice(0,10), created_by || null]);
  for (const l of lines) {
    await q(`INSERT INTO po_lines(po_id,sku,qty,cost) VALUES ($1,$2,$3,$4)`,
      [id, l.sku, l.qty, l.cost]);
  }
  res.json({ id });
}));

app.post("/api/grns", wrap(async (req,res)=>{
  const { po_id, notes, received_by } = req.body;
  const { rows: po } = await q(`SELECT supplier_id FROM purchase_orders WHERE id=$1`, [po_id]);
  const { rows: [{ next_number }] } = await q(`SELECT fn_next_number('GRN') AS next_number`);
  const id = next_number;
  await q(`INSERT INTO grns(id,po_id,supplier_id,date_received,notes,received_by)
           VALUES ($1,$2,$3,CURRENT_DATE,$4,$5)`,
    [id, po_id, po[0].supplier_id, notes || null, received_by || null]);
  await q(`INSERT INTO grn_lines(grn_id,sku,qty,cost)
           SELECT $1, sku, qty, cost FROM po_lines WHERE po_id = $2`, [id, po_id]);
  await q(`UPDATE purchase_orders SET status='Received', received_date=CURRENT_DATE WHERE id=$1`, [po_id]);
  res.json({ id });
}));

app.get("/api/grns", wrap(async (_req,res)=>{
  const { rows } = await q(`
    SELECT g.id, g.po_id AS "poId", s.name AS supplier,
           g.date_received AS "dateReceived", g.notes, u.name AS "receivedBy",
           COALESCE(JSON_AGG(JSON_BUILD_OBJECT('sku',gl.sku,'qty',gl.qty,'cost',gl.cost))
             FILTER (WHERE gl.id IS NOT NULL),'[]') AS lines
    FROM grns g
    JOIN suppliers s ON s.id = g.supplier_id
    LEFT JOIN users u ON u.id = g.received_by
    LEFT JOIN grn_lines gl ON gl.grn_id = g.id
    GROUP BY g.id, s.name, u.name
    ORDER BY g.date_received DESC`);
  res.json(rows);
}));

/* ============================================================
   INVOICES / B2B
   ============================================================ */
app.get("/api/invoices", wrap(async (_req,res)=>{
  const { rows } = await q(`
    SELECT i.id, c.name AS customer, i.invoice_date AS date, i.due_date AS due,
           i.total, i.status
    FROM invoices i JOIN customers c ON c.id = i.customer_id
    ORDER BY i.invoice_date DESC`);
  res.json(rows);
}));

app.post("/api/invoices/:id/pay", wrap(async (req,res)=>{
  const { amount } = req.body;
  await q(`UPDATE invoices SET amount_paid = amount_paid + $1,
             status = CASE WHEN amount_paid + $1 >= total THEN 'Paid' ELSE 'Partial' END
           WHERE id = $2`, [amount, req.params.id]);
  res.json({ ok: true });
}));

/* ============================================================
   SERVICES / RENTALS / SHRINK
   ============================================================ */
app.get("/api/services", wrap(async (_req,res)=>{
  const { rows } = await q(`
    SELECT t.id, t.service_type AS type, COALESCE(c.name,'Walk-in') AS customer,
           t.date_in AS "dateIn", t.status, t.price, t.notes
    FROM service_tickets t LEFT JOIN customers c ON c.id = t.customer_id
    ORDER BY t.date_in DESC, t.id DESC`);
  res.json(rows);
}));

app.post("/api/services", wrap(async (req,res)=>{
  const { service_type, customer_id, price, notes } = req.body;
  const { rows: [{ next_number }] } = await q(`SELECT fn_next_number('SRV') AS next_number`);
  await q(`INSERT INTO service_tickets(id,service_type,customer_id,date_in,status,price,notes)
           VALUES ($1,$2,$3,CURRENT_DATE,'Pending',$4,$5)`,
    [next_number, service_type, customer_id || null, price, notes]);
  res.json({ id: next_number });
}));

app.get("/api/rentals", wrap(async (_req,res)=>{
  const { rows } = await q(`
    SELECT r.id, r.tool_name AS tool, COALESCE(c.name,'Walk-in') AS customer,
           r.date_out AS "out", r.date_due AS due, r.date_returned AS returned,
           r.rate_per_day AS rate, r.late_fee AS "lateFee"
    FROM rental_contracts r LEFT JOIN customers c ON c.id = r.customer_id
    ORDER BY r.date_out DESC`);
  res.json(rows);
}));

app.post("/api/rentals", wrap(async (req, res) => {
  const { tool_sku, tool_name, customer_id, date_out, date_due, rate_per_day, late_fee = 0 } = req.body || {};
  const rate = Number(rate_per_day);
  const fee = Number(late_fee);
  if (!tool_name || !date_out || !date_due || !Number.isFinite(rate) || rate <= 0
      || !Number.isFinite(fee) || fee < 0 || date_due < date_out) {
    return res.status(400).json({ error: "A tool, valid rental dates, and non-negative charges are required." });
  }
  const { rows: [{ next_number: id }] } = await q(`SELECT fn_next_number('RNT') AS next_number`);
  await q(`
    INSERT INTO rental_contracts
      (id, tool_sku, tool_name, customer_id, date_out, date_due, rate_per_day, late_fee)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
  [id, tool_sku || null, tool_name, customer_id || null, date_out, date_due, rate, fee]);
  res.status(201).json({ id });
}));

app.get("/api/shrink", wrap(async (_req,res)=>{
  const { rows } = await q(`
    SELECT si.id, si.incident_date AS date, si.sku, i.name AS item, si.qty,
           i.uom_code AS uom, si.reason, si.department AS dept, si.value
    FROM shrink_incidents si LEFT JOIN items i ON i.sku = si.sku
    ORDER BY si.incident_date DESC`);
  res.json(rows);
}));

app.post("/api/shrink", wrap(async (req,res)=>{
  const { sku, qty, reason, logged_by } = req.body;
  const { rows: it } = await q(`SELECT cost, category_code FROM items WHERE sku=$1`, [sku]);
  const { rows: [{ next_number }] } = await q(`SELECT fn_next_number('SHR') AS next_number`);
  const value = Number(it[0]?.cost || 0) * Number(qty);
  const dept = it[0]?.category_code || "Unknown";
  await q(`INSERT INTO shrink_incidents(id,incident_date,sku,qty,reason,department,value,logged_by)
           VALUES ($1,CURRENT_DATE,$2,$3,$4,$5,$6,$7)`,
    [next_number, sku, qty, reason, dept, value, logged_by || null]);
  res.json({ id: next_number });
}));

export function initializeAuthSchema() {
  if (!globalThis[authSchemaKey]) {
    globalThis[authSchemaKey] = (async () => {
      await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT`);
      await q(`
        CREATE TABLE IF NOT EXISTS auth_sessions (
          token_hash TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires_at TIMESTAMPTZ NOT NULL
        )`);
      await q(`DELETE FROM auth_sessions WHERE expires_at <= NOW()`);

      if (process.env.AUTH_BOOTSTRAP_PASSWORD) {
        if (process.env.AUTH_BOOTSTRAP_PASSWORD.length < 12) {
          throw new Error("AUTH_BOOTSTRAP_PASSWORD must be at least 12 characters");
        }
        const email = (process.env.AUTH_BOOTSTRAP_EMAIL || "rick@store.lk").trim().toLowerCase();
        const { rowCount } = await q(`
          UPDATE users SET password_hash = $1
          WHERE lower(email) = $2 AND role_key = 'Owner' AND password_hash IS NULL AND active`,
        [await hashPassword(process.env.AUTH_BOOTSTRAP_PASSWORD), email]);
        if (rowCount) console.log(`Initial Owner password configured for ${email}`);
      }
    })();
  }
  return globalThis[authSchemaKey];
}

export function initializeFinanceSchema() {
  if (!globalThis[financeSchemaKey]) {
    globalThis[financeSchemaKey] = (async () => {
      await q(`
        CREATE TABLE IF NOT EXISTS chart_of_accounts (
          code TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          account_type TEXT NOT NULL CHECK (account_type IN ('Asset','Liability','Equity','Revenue','COGS','Expense')),
          parent_code TEXT,
          postable BOOLEAN NOT NULL DEFAULT TRUE,
          contra BOOLEAN NOT NULL DEFAULT FALSE
        )`);
      await q(`
        INSERT INTO chart_of_accounts (code, name, account_type, parent_code, postable, contra)
        VALUES
          ('1100', 'Cash and Cash Equivalents', 'Asset', NULL, TRUE, FALSE),
          ('1110', 'Bank Current Account', 'Asset', NULL, TRUE, FALSE),
          ('1200', 'Accounts Receivable', 'Asset', NULL, TRUE, FALSE),
          ('1300', 'Inventory', 'Asset', NULL, TRUE, FALSE),
          ('1400', 'Cost of Goods Sold', 'COGS', NULL, TRUE, FALSE),
          ('1500', 'Fixed Assets', 'Asset', NULL, TRUE, FALSE),
          ('1510', 'Equipment', 'Asset', '1500', TRUE, FALSE),
          ('1520', 'Vehicles', 'Asset', '1500', TRUE, FALSE),
          ('1690', 'Accumulated Depreciation', 'Asset', NULL, TRUE, TRUE),
          ('2100', 'Accounts Payable', 'Liability', NULL, TRUE, FALSE),
          ('2200', 'VAT Payable', 'Liability', NULL, TRUE, FALSE),
          ('2210', 'VAT Receivable', 'Asset', NULL, TRUE, FALSE),
          ('2300', 'Customer Deposits', 'Liability', NULL, TRUE, FALSE),
          ('2400', 'Accrued Expenses', 'Liability', NULL, TRUE, FALSE),
          ('2500', 'Other Tax Payable', 'Liability', NULL, TRUE, FALSE),
          ('3000', 'Owners Equity', 'Equity', NULL, TRUE, FALSE),
          ('3100', 'Retained Earnings', 'Equity', NULL, TRUE, FALSE),
          ('3200', 'Owner Drawings', 'Equity', NULL, TRUE, TRUE),
          ('4100', 'Sales Revenue', 'Revenue', NULL, TRUE, FALSE),
          ('4200', 'Service Revenue', 'Revenue', NULL, TRUE, FALSE),
          ('4300', 'Rental Revenue', 'Revenue', NULL, TRUE, FALSE),
          ('4400', 'Other Income', 'Revenue', NULL, TRUE, FALSE),
          ('4900', 'Sales Returns', 'Revenue', NULL, TRUE, TRUE),
          ('5100', 'Operating Expenses', 'Expense', NULL, TRUE, FALSE),
          ('6100', 'Rent Expense', 'Expense', NULL, TRUE, FALSE),
          ('6200', 'Utilities Expense', 'Expense', NULL, TRUE, FALSE),
          ('6300', 'Travel Expense', 'Expense', NULL, TRUE, FALSE),
          ('6400', 'Supplies Expense', 'Expense', NULL, TRUE, FALSE),
          ('6500', 'Depreciation Expense', 'Expense', NULL, TRUE, FALSE),
          ('6600', 'Shrinkage Expense', 'Expense', NULL, TRUE, FALSE),
          ('6700', 'Bank Charges', 'Expense', NULL, TRUE, FALSE),
          ('6800', 'Repairs and Maintenance', 'Expense', NULL, TRUE, FALSE),
          ('6900', 'Other Expense', 'Expense', NULL, TRUE, FALSE)
        ON CONFLICT (code) DO NOTHING`);
      await q(`
        CREATE TABLE IF NOT EXISTS journal_entries (
          id TEXT PRIMARY KEY,
          entry_date DATE NOT NULL,
          description TEXT NOT NULL,
          source TEXT NOT NULL,
          ref TEXT,
          created_by INTEGER REFERENCES users(id),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      await q(`
        CREATE TABLE IF NOT EXISTS journal_lines (
          id SERIAL PRIMARY KEY,
          je_id TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
          account_code TEXT NOT NULL REFERENCES chart_of_accounts(code),
          debit NUMERIC(14,2) NOT NULL DEFAULT 0,
          credit NUMERIC(14,2) NOT NULL DEFAULT 0
        )`);
      await q(`
        CREATE TABLE IF NOT EXISTS expense_categories (
          code TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          account_code TEXT NOT NULL DEFAULT '5100' REFERENCES chart_of_accounts(code)
        )`);
      await q(`ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS account_code TEXT REFERENCES chart_of_accounts(code)`);
      await q(`
        UPDATE expense_categories
        SET account_code = CASE code
          WHEN 'ELEC' THEN '6200'
          WHEN 'RENT' THEN '6100'
          WHEN 'TRVL' THEN '6300'
          WHEN 'SUPP' THEN '6400'
          ELSE '5100'
        END
        WHERE account_code IS NULL`);
      await q(`ALTER TABLE expense_categories ALTER COLUMN account_code SET DEFAULT '5100'`);
      await q(`ALTER TABLE expense_categories ALTER COLUMN account_code SET NOT NULL`);
      await q(`
        CREATE TABLE IF NOT EXISTS expenses (
          id TEXT PRIMARY KEY,
          category_code TEXT REFERENCES expense_categories(code),
          expense_date DATE NOT NULL,
          amount NUMERIC(14,2) NOT NULL DEFAULT 0,
          vendor TEXT,
          notes TEXT,
          posted BOOLEAN NOT NULL DEFAULT FALSE,
          created_by INTEGER REFERENCES users(id),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      await q(`
        CREATE TABLE IF NOT EXISTS fixed_assets (
          id SERIAL PRIMARY KEY,
          code TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          cost NUMERIC(14,2) NOT NULL DEFAULT 0,
          life_years INTEGER NOT NULL DEFAULT 1,
          salvage NUMERIC(14,2) NOT NULL DEFAULT 0,
          accumulated_depreciation NUMERIC(14,2) NOT NULL DEFAULT 0,
          active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      await q(`
        CREATE TABLE IF NOT EXISTS budgets (
          period TEXT NOT NULL,
          account_code TEXT NOT NULL REFERENCES chart_of_accounts(code),
          amount NUMERIC(14,2) NOT NULL DEFAULT 0,
          PRIMARY KEY (period, account_code)
        )`);
      await q(`
        CREATE TABLE IF NOT EXISTS period_locks (
          lock_through_date DATE PRIMARY KEY,
          created_by INTEGER REFERENCES users(id),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
      await q(`
        CREATE TABLE IF NOT EXISTS bank_reconciliations (
          id SERIAL PRIMARY KEY,
          je_line_id INTEGER NOT NULL REFERENCES journal_lines(id),
          reconciled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          reconciled_by INTEGER REFERENCES users(id),
          UNIQUE (je_line_id)
        )`);
      await q(`CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_reconciliations_line ON bank_reconciliations (je_line_id)`);
      await q(`ALTER TABLE grns ADD COLUMN IF NOT EXISTS paid BOOLEAN NOT NULL DEFAULT FALSE`);
      await q(`ALTER TABLE grns ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(14,2) NOT NULL DEFAULT 0`);
      await q(`
        INSERT INTO number_series (code, prefix, year, next, pad, descr)
        VALUES
          ('JE', 'JE', TO_CHAR(CURRENT_DATE, 'YYYY'), 1, 5, 'Journal Entry'),
          ('EXP', 'EXP', TO_CHAR(CURRENT_DATE, 'YYYY'), 1, 5, 'Expense Voucher')
        ON CONFLICT (code) DO NOTHING`);
      await q(`
        CREATE OR REPLACE FUNCTION fn_post_journal(
          p_entry_date DATE,
          p_description TEXT,
          p_source TEXT,
          p_ref TEXT,
          p_lines JSONB,
          p_created_by INTEGER
        ) RETURNS TEXT AS $$
        DECLARE
          v_je_id TEXT;
          v_debit NUMERIC(14,2) := 0;
          v_credit NUMERIC(14,2) := 0;
          v_line JSONB;
        BEGIN
          IF jsonb_typeof(COALESCE(p_lines, '[]'::jsonb)) <> 'array'
             OR jsonb_array_length(COALESCE(p_lines, '[]'::jsonb)) < 2 THEN
            RAISE EXCEPTION 'Journal entry requires at least two lines.';
          END IF;
          PERFORM pg_advisory_xact_lock(7319422);
          IF EXISTS (SELECT 1 FROM period_locks WHERE lock_through_date >= p_entry_date) THEN
            RAISE EXCEPTION 'Period is locked for backdated journal entries.' USING HINT = 'Use a date after the latest lock date.';
          END IF;
          FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) LOOP
            IF COALESCE((v_line->>'debit')::NUMERIC, 0) < 0
               OR COALESCE((v_line->>'credit')::NUMERIC, 0) < 0
               OR (COALESCE((v_line->>'debit')::NUMERIC, 0) > 0
                   AND COALESCE((v_line->>'credit')::NUMERIC, 0) > 0) THEN
              RAISE EXCEPTION 'Journal line amounts must be non-negative and either debit or credit.';
            END IF;
            v_debit := v_debit + COALESCE((v_line->>'debit')::NUMERIC, 0);
            v_credit := v_credit + COALESCE((v_line->>'credit')::NUMERIC, 0);
          END LOOP;
          IF v_debit <= 0 OR ABS(v_debit - v_credit) > 0.009 THEN
            RAISE EXCEPTION 'Journal entry must balance.' USING HINT = 'Debits and credits must match.';
          END IF;
          v_je_id := fn_next_number('JE');
          INSERT INTO journal_entries (id, entry_date, description, source, ref, created_by)
          VALUES (v_je_id, p_entry_date, p_description, p_source, p_ref, p_created_by);
          INSERT INTO journal_lines (je_id, account_code, debit, credit)
          SELECT v_je_id,
                 (line->>'account_code')::TEXT,
                 COALESCE((line->>'debit')::NUMERIC, 0),
                 COALESCE((line->>'credit')::NUMERIC, 0)
          FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) AS line;
          RETURN v_je_id;
        END;
        $$ LANGUAGE plpgsql`);
      await q(`
        CREATE OR REPLACE FUNCTION fn_post_sale_finance(p_sale_id TEXT, p_created_by INTEGER DEFAULT NULL)
        RETURNS TEXT AS $$
        DECLARE
          v_sale sales%ROWTYPE;
          v_revenue NUMERIC(14,2);
          v_cogs NUMERIC(14,2);
          v_lines JSONB;
          v_je_id TEXT;
        BEGIN
          PERFORM pg_advisory_xact_lock(hashtext('finance:POS:' || p_sale_id));
          SELECT id INTO v_je_id FROM journal_entries
          WHERE source = 'POS' AND ref = p_sale_id LIMIT 1;
          IF v_je_id IS NOT NULL THEN RETURN v_je_id; END IF;

          SELECT * INTO v_sale FROM sales WHERE id = p_sale_id;
          IF NOT FOUND THEN RAISE EXCEPTION 'Sale % not found.', p_sale_id; END IF;
          SELECT COALESCE(v_sale.subtotal - v_sale.discount, 0),
                 COALESCE(SUM(sl.qty * sl.cost_at_sale), 0)
          INTO v_revenue, v_cogs
          FROM sale_lines sl WHERE sl.sale_id = p_sale_id;

          v_lines := jsonb_build_array(
            jsonb_build_object('account_code',
              CASE WHEN v_sale.payment_method = 'On Account (B2B)' THEN '1200' ELSE '1100' END,
              'debit', v_sale.total, 'credit', 0),
            jsonb_build_object('account_code','4100','debit',0,'credit',v_revenue),
            jsonb_build_object('account_code','2200','debit',0,'credit',COALESCE(v_sale.tax,0)),
            jsonb_build_object('account_code','1400','debit',v_cogs,'credit',0),
            jsonb_build_object('account_code','1300','debit',0,'credit',v_cogs)
          );
          RETURN fn_post_journal(
            v_sale.sale_date, 'POS sale ' || v_sale.id, 'POS', v_sale.id, v_lines,
            COALESCE(p_created_by, v_sale.cashier_id)
          );
        END;
        $$ LANGUAGE plpgsql`);
      await q(`
        CREATE OR REPLACE FUNCTION fn_post_grn_finance(p_grn_id TEXT)
        RETURNS TEXT AS $$
        DECLARE
          v_total NUMERIC(14,2);
          v_vat NUMERIC(14,2);
          v_date DATE;
          v_user INTEGER;
          v_lines JSONB;
          v_je_id TEXT;
        BEGIN
          PERFORM pg_advisory_xact_lock(hashtext('finance:GRN:' || p_grn_id));
          SELECT id INTO v_je_id FROM journal_entries
          WHERE source = 'GRN' AND ref = p_grn_id LIMIT 1;
          IF v_je_id IS NOT NULL THEN RETURN v_je_id; END IF;

          SELECT g.date_received, g.received_by,
                 COALESCE(SUM(gl.qty * gl.cost), 0),
                 COALESCE(SUM(gl.qty * gl.cost * COALESCE(t.rate, 0) / 100), 0)
          INTO v_date, v_user, v_total, v_vat
          FROM grns g
          LEFT JOIN grn_lines gl ON gl.grn_id = g.id
          LEFT JOIN items i ON i.sku = gl.sku
          LEFT JOIN tax_codes t ON t.code = i.tax_code
          WHERE g.id = p_grn_id
          GROUP BY g.id;
          IF NOT FOUND THEN RAISE EXCEPTION 'GRN % not found.', p_grn_id; END IF;
          v_lines := jsonb_build_array(
            jsonb_build_object('account_code','1300','debit',v_total,'credit',0),
            jsonb_build_object('account_code','2210','debit',v_vat,'credit',0),
            jsonb_build_object('account_code','2100','debit',0,'credit',v_total + v_vat)
          );
          RETURN fn_post_journal(v_date, 'GRN ' || p_grn_id, 'GRN', p_grn_id, v_lines, v_user);
        END;
        $$ LANGUAGE plpgsql`);
      await q(`
        CREATE OR REPLACE FUNCTION trg_grn_lines_finance()
        RETURNS TRIGGER AS $$
        DECLARE v_grn_id TEXT;
        BEGIN
          FOR v_grn_id IN SELECT DISTINCT grn_id FROM inserted_grn_lines LOOP
            PERFORM fn_post_grn_finance(v_grn_id);
          END LOOP;
          RETURN NULL;
        END;
        $$ LANGUAGE plpgsql`);
      await q(`
        CREATE OR REPLACE FUNCTION fn_post_service_finance(p_service_id TEXT)
        RETURNS TEXT AS $$
        DECLARE
          v_date DATE;
          v_price NUMERIC(14,2);
          v_je_id TEXT;
        BEGIN
          PERFORM pg_advisory_xact_lock(hashtext('finance:SERVICE:' || p_service_id));
          SELECT id INTO v_je_id FROM journal_entries
          WHERE source = 'SERVICE' AND ref = p_service_id LIMIT 1;
          IF v_je_id IS NOT NULL THEN RETURN v_je_id; END IF;
          SELECT date_in, price INTO v_date, v_price
          FROM service_tickets WHERE id = p_service_id;
          IF NOT FOUND THEN RAISE EXCEPTION 'Service ticket % not found.', p_service_id; END IF;
          IF v_price <= 0 THEN RETURN NULL; END IF;
          RETURN fn_post_journal(v_date, 'Service ' || p_service_id, 'SERVICE', p_service_id,
            jsonb_build_array(
              jsonb_build_object('account_code','1200','debit',v_price,'credit',0),
              jsonb_build_object('account_code','4200','debit',0,'credit',v_price)
            ), NULL);
        END;
        $$ LANGUAGE plpgsql`);
      await q(`
        CREATE OR REPLACE FUNCTION trg_service_finance()
        RETURNS TRIGGER AS $$
        BEGIN
          PERFORM fn_post_service_finance(NEW.id);
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql`);
      await q(`
        CREATE OR REPLACE FUNCTION fn_post_rental_finance(p_rental_id TEXT)
        RETURNS TEXT AS $$
        DECLARE
          v_date DATE;
          v_amount NUMERIC(14,2);
          v_je_id TEXT;
        BEGIN
          PERFORM pg_advisory_xact_lock(hashtext('finance:RENTAL:' || p_rental_id));
          SELECT id INTO v_je_id FROM journal_entries
          WHERE source = 'RENTAL' AND ref = p_rental_id LIMIT 1;
          IF v_je_id IS NOT NULL THEN RETURN v_je_id; END IF;
          SELECT date_out, (GREATEST(date_due - date_out, 1) * rate_per_day) + late_fee
          INTO v_date, v_amount
          FROM rental_contracts WHERE id = p_rental_id;
          IF NOT FOUND THEN RAISE EXCEPTION 'Rental contract % not found.', p_rental_id; END IF;
          IF v_amount <= 0 THEN RETURN NULL; END IF;
          RETURN fn_post_journal(v_date, 'Rental ' || p_rental_id, 'RENTAL', p_rental_id,
            jsonb_build_array(
              jsonb_build_object('account_code','1200','debit',v_amount,'credit',0),
              jsonb_build_object('account_code','4300','debit',0,'credit',v_amount)
            ), NULL);
        END;
        $$ LANGUAGE plpgsql`);
      await q(`
        CREATE OR REPLACE FUNCTION trg_rental_finance()
        RETURNS TRIGGER AS $$
        BEGIN
          PERFORM fn_post_rental_finance(NEW.id);
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql`);
      await q(`
        CREATE OR REPLACE FUNCTION trg_invoice_payment_finance()
        RETURNS TRIGGER AS $$
        DECLARE v_amount NUMERIC(14,2);
        BEGIN
          v_amount := NEW.amount_paid - OLD.amount_paid;
          IF v_amount <= 0 THEN RETURN NEW; END IF;
          PERFORM fn_post_journal(CURRENT_DATE, 'AR receipt ' || NEW.id, 'AR', NEW.id,
            jsonb_build_array(
              jsonb_build_object('account_code','1100','debit',v_amount,'credit',0),
              jsonb_build_object('account_code','1200','debit',0,'credit',v_amount)
            ), NULL);
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql`);
      await q(`
        CREATE OR REPLACE FUNCTION trg_expense_finance()
        RETURNS TRIGGER AS $$
        DECLARE v_account_code TEXT;
        BEGIN
          IF NOT NEW.posted THEN RETURN NEW; END IF;
          SELECT account_code INTO v_account_code
          FROM expense_categories WHERE code = NEW.category_code;
          IF v_account_code IS NULL THEN
            RAISE EXCEPTION 'Expense category % has no ledger account.', NEW.category_code;
          END IF;
          PERFORM fn_post_journal(NEW.expense_date, 'Expense ' || NEW.id, 'EXPENSE', NEW.id,
            jsonb_build_array(
              jsonb_build_object('account_code',v_account_code,'debit',NEW.amount,'credit',0),
              jsonb_build_object('account_code','1100','debit',0,'credit',NEW.amount)
            ), NEW.created_by);
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql`);
      await q(`
        CREATE OR REPLACE FUNCTION trg_shrink_finance()
        RETURNS TRIGGER AS $$
        BEGIN
          IF COALESCE(NEW.value, 0) <= 0 THEN RETURN NEW; END IF;
          PERFORM fn_post_journal(NEW.incident_date, 'Shrink incident ' || NEW.id, 'SHRINK', NEW.id,
            jsonb_build_array(
              jsonb_build_object('account_code','6600','debit',NEW.value,'credit',0),
              jsonb_build_object('account_code','1300','debit',0,'credit',NEW.value)
            ), NEW.logged_by);
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql`);
      await q(`DROP TRIGGER IF EXISTS trg_sales_finance ON sales`);
      await q(`DROP TRIGGER IF EXISTS trg_grn_finance ON grns`);
      await q(`DROP TRIGGER IF EXISTS trg_grn_lines_finance ON grn_lines`);
      await q(`DROP TRIGGER IF EXISTS trg_service_finance ON service_tickets`);
      await q(`DROP TRIGGER IF EXISTS trg_rental_finance ON rental_contracts`);
      await q(`DROP TRIGGER IF EXISTS trg_shrink_finance ON shrink_incidents`);
      await q(`DROP TRIGGER IF EXISTS trg_invoice_payment_finance ON invoices`);
      await q(`DROP TRIGGER IF EXISTS trg_expense_finance ON expenses`);
      await q(`
        CREATE TRIGGER trg_grn_lines_finance
        AFTER INSERT ON grn_lines
        REFERENCING NEW TABLE AS inserted_grn_lines
        FOR EACH STATEMENT EXECUTE FUNCTION trg_grn_lines_finance()`);
      await q(`
        CREATE TRIGGER trg_service_finance
        AFTER INSERT ON service_tickets
        FOR EACH ROW EXECUTE FUNCTION trg_service_finance()`);
      await q(`
        CREATE TRIGGER trg_rental_finance
        AFTER INSERT ON rental_contracts
        FOR EACH ROW EXECUTE FUNCTION trg_rental_finance()`);
      await q(`
        CREATE TRIGGER trg_shrink_finance
        AFTER INSERT ON shrink_incidents
        FOR EACH ROW EXECUTE FUNCTION trg_shrink_finance()`);
      await q(`
        CREATE TRIGGER trg_invoice_payment_finance
        AFTER UPDATE OF amount_paid ON invoices
        FOR EACH ROW
        WHEN (NEW.amount_paid > OLD.amount_paid)
        EXECUTE FUNCTION trg_invoice_payment_finance()`);
      await q(`
        CREATE TRIGGER trg_expense_finance
        AFTER INSERT ON expenses
        FOR EACH ROW EXECUTE FUNCTION trg_expense_finance()`);
      await q(`
        INSERT INTO expense_categories (code, name, account_code)
        VALUES
          ('ELEC', 'Electricity', '6200'),
          ('RENT', 'Rent', '6100'),
          ('TRVL', 'Travel', '6300'),
          ('SUPP', 'Supplies', '6400')
        ON CONFLICT (code) DO NOTHING`);
      await q(`
        INSERT INTO role_permissions (role_key, perm_key, granted)
        VALUES
          ('Owner','finance',TRUE),('Owner','finance_edit',TRUE),
          ('Manager','finance',TRUE),('Manager','finance_edit',TRUE),
          ('Cashier','finance',FALSE),('Cashier','finance_edit',FALSE),
          ('Storekeeper','finance',FALSE),('Storekeeper','finance_edit',FALSE),
          ('Accountant','finance',TRUE),('Accountant','finance_edit',TRUE)
        ON CONFLICT (role_key, perm_key) DO NOTHING`);
      const seedClient = await connectDb();
      try {
        await seedClient.query("BEGIN");
        await seedClient.query(`SELECT pg_advisory_xact_lock(7319423)`);
        const { rows: existingJournal } = await seedClient.query(`SELECT 1 FROM journal_entries LIMIT 1`);
        if (!existingJournal.length) {
          const { rows: [opening] } = await seedClient.query(`
          SELECT
            COALESCE((SELECT SUM(inv.qty * i.cost) FROM inventory inv JOIN items i ON i.sku = inv.sku),0) AS inventory,
            COALESCE((SELECT SUM(total - amount_paid) FROM invoices
                      WHERE status NOT IN ('Paid','Cancelled')),0) AS receivables,
            COALESCE((SELECT SUM(total - amount_paid) FROM (
              SELECT g.id, g.amount_paid,
                     ROUND(SUM(gl.qty * gl.cost),2)
                       + ROUND(SUM(gl.qty * gl.cost * COALESCE(t.rate,0) / 100),2) AS total
              FROM grns g
              JOIN grn_lines gl ON gl.grn_id = g.id
              JOIN items i ON i.sku = gl.sku
              LEFT JOIN tax_codes t ON t.code = i.tax_code
              WHERE g.paid = FALSE
              GROUP BY g.id
            ) payable_balances),0) AS payables,
            COALESCE((SELECT SUM(cost) FROM fixed_assets WHERE active = TRUE),0) AS fixed_assets,
            COALESCE((SELECT SUM(accumulated_depreciation) FROM fixed_assets WHERE active = TRUE),0) AS accumulated_depreciation,
            COALESCE((
              SELECT MIN(transaction_date)
              FROM (
                SELECT sale_date AS transaction_date FROM sales
                UNION ALL SELECT date_received FROM grns
                UNION ALL SELECT invoice_date FROM invoices
                UNION ALL SELECT incident_date FROM shrink_incidents
              ) transactions
            ), CURRENT_DATE) - 1 AS entry_date`);
          const openingLines = [];
          const addOpeningLine = (account_code, rawAmount, debitNormal) => {
            const cents = Math.round(Number(rawAmount || 0) * 100);
            if (!cents) return;
            const debit = (cents > 0) === debitNormal ? Math.abs(cents) / 100 : 0;
            const credit = debit ? 0 : Math.abs(cents) / 100;
            openingLines.push({ account_code, debit, credit });
          };
          addOpeningLine("1300", opening.inventory, true);
          addOpeningLine("1200", opening.receivables, true);
          addOpeningLine("1500", opening.fixed_assets, true);
          addOpeningLine("2100", opening.payables, false);
          addOpeningLine("1690", opening.accumulated_depreciation, false);
          const netDebitCents = openingLines.reduce((sum, line) =>
            sum + Math.round((line.debit - line.credit) * 100), 0);
          if (netDebitCents) {
            addOpeningLine("3000", netDebitCents / 100, false);
          }
          if (openingLines.length) {
            await seedClient.query(`
            SELECT fn_post_journal($1, 'Opening balances', 'OPENING', 'FINANCE-OPENING',
              $2::jsonb, NULL)`,
            [opening.entry_date, JSON.stringify(openingLines)]);
          }
        }
        await seedClient.query("COMMIT");
      } catch (err) {
        await seedClient.query("ROLLBACK");
        throw err;
      } finally {
        seedClient.release();
      }
    })();
  }
  return globalThis[financeSchemaKey];
}

let httpServer;
let stopPromise;

export async function startServer(port = process.env.PORT || 4000, host) {
  await ensureAuthSchema();
  await initializeFinanceSchema();
  await new Promise((resolveListen, rejectListen) => {
    const onError = error => {
      httpServer = undefined;
      rejectListen(error);
    };
    httpServer = host
      ? app.listen(port, host, () => resolveListen())
      : app.listen(port, () => resolveListen());
    httpServer.once("error", onError);
    httpServer.once("listening", () => httpServer.off("error", onError));
  });
  const address = httpServer.address();
  console.log(`HardwareOps API listening on :${typeof address === "object" ? address.port : port}`);
  return httpServer;
}

export function stopServer() {
  if (!stopPromise) {
    stopPromise = (async () => {
      if (httpServer) {
        await new Promise((resolveClose, rejectClose) => {
          httpServer.close(error => error ? rejectClose(error) : resolveClose());
        });
        httpServer = undefined;
      }
      const pool = globalThis[poolKey];
      if (pool) {
        await pool.end();
        delete globalThis[poolKey];
      }
    })();
  }
  return stopPromise;
}

export { app };
export default app;

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  startServer().catch(err => {
    console.error("Failed to start HardwareOps API:", err);
    process.exitCode = 1;
  });
}