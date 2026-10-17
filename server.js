// npm i express pg cors dotenv
import express from "express";
import pg from "pg";
import cors from "cors";
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import "dotenv/config";
import { getDatabaseConfig } from "./database-config.js";

const app = express();
app.use(cors());
app.use(express.json());
const scrypt = promisify(scryptCallback);

const pool = new pg.Pool({
  ...getDatabaseConfig(),
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
  connectionTimeoutMillis: Number(process.env.PG_CONN_TIMEOUT_MS || 10000)
});

const q = (text, params) => pool.query(text, params);

/* ---------- helpers ---------- */
const wrap = fn => (req, res) =>
  fn(req, res).catch(err => {
    console.error(err);
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
}));

app.post("/api/logout", wrap(async (req, res) => {
  const token = bearerToken(req);
  if (token) await q(`DELETE FROM auth_sessions WHERE token_hash = $1`, [hashSessionToken(token)]);
  res.json({ ok: true });
}));

app.use("/api", requireAuth);

async function requireMasterEdit(req, res, next) {
  try {
    const { rows } = await q(`
      SELECT granted FROM role_permissions
      WHERE role_key = $1 AND perm_key = 'masters_edit'`,
    [req.user.role]);
    if (!rows[0]?.granted) return res.status(403).json({ error: "Master data editing is not permitted for this role." });
    next();
  } catch (err) {
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
  const client = await pool.connect();
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
  const client = await pool.connect();
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
  const { rows } = await q(`SELECT sp_complete_sale($1,$2,$3,$4,$5,$6) AS sale_id`,
    [customer_id || null, cashier_id, payment, tier, tax_applied, JSON.stringify(lines)]);
  res.json({ id: rows[0].sale_id });
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

async function initializeAuthSchema() {
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
}

let httpServer;
let stopPromise;

export async function startServer(port = process.env.PORT || 4000, host) {
  await initializeAuthSchema();
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
      await pool.end();
    })();
  }
  return stopPromise;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  startServer().catch(err => {
    console.error("Failed to start HardwareOps API:", err);
    process.exitCode = 1;
  });
}