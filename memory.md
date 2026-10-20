# Finance Module — Persistent Memory

> Read this first before editing anything. It captures the *current* state,
> the *contracts* the existing stack relies on, and the decisions made during
> planning so the same mistakes aren't repeated.

---

## 1. Existing System Snapshot

| Aspect | Value |
|---|---|
| Backend file | `server.js` (single file, ESM, ~900 lines) |
| DB file | `db.sql` (schema + seed + views + triggers + stored proc) |
| Frontend file | `index.html` (single file, vanilla JS SPA) |
| Runtime | Node 20+, `npm i express pg cors dotenv` |
| DB | PostgreSQL 15+ on Aiven (`slict-slict.d.aivencloud.com:21354/hardwareops`) |
| DB pool | `PG_POOL_MAX` default **1** — one connection, everything serializes |
| Auth | Bearer token → `auth_sessions.token_hash` (sha256) → `users` row |
| Session TTL | 12 hours (`NOW() + INTERVAL '12 hours'`) |
| Password | `scrypt` (salt 16B, hash 64B), format `scrypt$<salt_hex>$<hash_hex>` |
| Password rule | Minimum **12 chars** (enforced server-side) |
| Roles | Owner, Manager, Cashier, Storekeeper, Accountant |
| Perm keys | dashboard, pos, inventory, po, grn, services, rentals, b2b, shrink, gmroi, analytics, masters, masters_edit, numberseries, users_manage |
| Domain | Sri Lanka, LKR, VAT 18% standard |
| Session storage | `sessionStorage.hardwareopsSession` |

### Existing Tables You Must Not Break