import { readFileSync } from "node:fs";

export function getDatabaseConfig(env = process.env) {
  const target = env.DATABASE_TARGET?.trim().toLowerCase();
  let databaseUrl;
  let sslMode;

  if (target) {
    if (target !== "local" && target !== "aiven") {
      throw new Error('DATABASE_TARGET must be either "local" or "aiven".');
    }

    const key = target === "local" ? "DATABASE_URL_LOCAL" : "DATABASE_URL_AIVEN";
    databaseUrl = env[key]?.trim();
    sslMode = target === "aiven" ? "require" : "disable";
    if (!databaseUrl) {
      throw new Error(`Database configuration is missing. Set ${key} in .env.`);
    }
  } else {
    databaseUrl = env.DATABASE_URL?.trim();
    if (!databaseUrl) {
      throw new Error("Database configuration is missing. Set DATABASE_URL in .env.");
    }
  }

  let connectionUrl;
  try {
    connectionUrl = new URL(databaseUrl);
  } catch {
    throw new Error("Database URL must be a valid PostgreSQL connection URL.");
  }
  if (connectionUrl.protocol !== "postgres:" && connectionUrl.protocol !== "postgresql:") {
    throw new Error("Database URL must use the postgres or postgresql protocol.");
  }

  sslMode ??= env.PGSSLMODE?.trim().toLowerCase()
    || connectionUrl.searchParams.get("sslmode")
    || "disable";
  if (sslMode !== "require" && sslMode !== "disable") {
    throw new Error('PGSSLMODE must be either "require" or "disable".');
  }

  connectionUrl.searchParams.delete("sslmode");
  const ca = env.PGSSLROOTCERT_CONTENT?.trim()
    || (env.PGSSLROOTCERT ? readFileSync(env.PGSSLROOTCERT, "utf8") : undefined);
  const ssl = sslMode === "require"
    ? {
        rejectUnauthorized: true,
        ...(ca ? { ca } : {})
      }
    : false;
  return {
    connectionString: connectionUrl.toString(),
    ssl
  };
}
