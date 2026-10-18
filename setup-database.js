import { execFile } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "dotenv";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const execFileAsync = promisify(execFile);
const projectDir = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(projectDir, "db.sql");
const envPath = path.join(projectDir, ".env");
const aivenHost = "slict-slict.d.aivencloud.com";
const aivenPort = "21354";

export function normalizeCompanyName(value) {
  const normalized = value.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(normalized)) {
    throw new Error("Company name must normalize to 1-63 characters, start with a letter, and contain only letters, numbers, or underscores.");
  }
  return normalized;
}

export function updateEnvText(text, values) {
  const updates = new Map(Object.entries(values));
  const seen = new Set();
  const lines = text.split(/\r?\n/);
  const result = [];

  for (const line of lines) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    const key = match?.[1];
    if (!updates.has(key)) {
      result.push(line);
    } else if (!seen.has(key)) {
      const inlineComment = line.match(/(\s+#.*)$/)?.[1] || "";
      result.push(`${key}=${updates.get(key)}${inlineComment}`);
      seen.add(key);
    }
  }

  for (const [key, value] of updates) {
    if (!seen.has(key)) result.push(`${key}=${value}`);
  }
  while (result.length && result.at(-1) === "") result.pop();
  return `${result.join(os.EOL)}${os.EOL}`;
}

async function run(file, args, options = {}) {
  const { quiet = false, ...execOptions } = options;
  try {
    const { stdout: output, stderr } = await execFileAsync(file, args, {
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
      ...execOptions
    });
    if (!quiet && output.trim()) stdout.write(output);
    if (!quiet && stderr.trim()) process.stderr.write(stderr);
    return output.trim();
  } catch (error) {
    const detail = error.stderr?.trim() || error.stdout?.trim() || error.message;
    throw new Error(`${path.basename(file)} failed: ${detail}`, { cause: error });
  }
}

async function findPsql() {
  if (process.platform === "win32") {
    const candidates = [
      path.join(process.env.ProgramFiles || "C:\\Program Files", "PostgreSQL", "16", "bin", "psql.exe"),
      path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "PostgreSQL", "16", "bin", "psql.exe")
    ];
    for (const candidate of candidates) {
      try {
        await access(candidate);
        return candidate;
      } catch {}
    }
    try {
      const output = await run("where.exe", ["psql.exe"]);
      return output.split(/\r?\n/)[0];
    } catch {
      return undefined;
    }
  }

  for (const directory of (process.env.PATH || "").split(path.delimiter)) {
    const candidate = path.join(directory, "psql");
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }
  return undefined;
}

async function ensurePsql(target) {
  let psql = await findPsql();
  if (!psql && process.platform === "win32" && target === "local") {
    console.log("psql was not found; installing PostgreSQL 16 with winget.");
    await run("winget", [
      "install", "--id", "PostgreSQL.PostgreSQL.16", "-e", "--silent",
      "--accept-package-agreements", "--accept-source-agreements"
    ]);
    psql = await findPsql();
  }
  if (!psql) {
    if (process.platform === "linux") {
      throw new Error("psql was not found on PATH. Install PostgreSQL client tools and rerun the build.");
    }
    throw new Error(target === "local"
      ? "psql was not found after the PostgreSQL installation. Install PostgreSQL 16 and rerun the build."
      : "psql was not found on PATH. Install PostgreSQL client tools and rerun the build.");
  }
  return psql;
}

async function ensurePostgresRunning() {
  if (process.platform === "win32") {
    const command = [
      "$services = @(Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue);",
      "if ($services.Count -eq 0) { throw 'No PostgreSQL service was found.' };",
      "$services | ForEach-Object { if ($_.Status -ne 'Running') { Start-Service -Name $_.Name } };",
      "$services | ForEach-Object {",
      "  $service = Get-Service -Name $_.Name;",
      "  if ($service.Status -ne 'Running') { throw ('PostgreSQL service ' + $_.Name + ' did not start.') }",
      "}"
    ].join(" ");
    await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command]);
    return;
  }

  try {
    const state = await run("systemctl", ["is-active", "postgresql"]);
    if (state === "active") return;
    await run("systemctl", ["start", "postgresql"]);
  } catch (systemdError) {
    try {
      await run("service", ["postgresql", "status"]);
    } catch {
      await run("service", ["postgresql", "start"]);
    }
    if (systemdError.cause?.code === "ENOENT") return;
  }
}

function setDatabaseName(baseUrl, databaseName) {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url;
}

function getAivenBaseUrl(envValues) {
  const value = envValues.DATABASE_URL_AIVEN;
  if (!value) {
    throw new Error("DATABASE_URL_AIVEN is missing from the repository .env; configure Aiven credentials before selecting that target.");
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DATABASE_URL_AIVEN must be a valid PostgreSQL URL.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("DATABASE_URL_AIVEN must use the postgres or postgresql protocol.");
  }
  url.hostname = aivenHost;
  url.port = aivenPort;
  url.searchParams.set("sslmode", "require");
  return url;
}

async function runPsql(psql, databaseUrl, args, password) {
  await run(psql, ["-w", "-v", "ON_ERROR_STOP=1", ...args, databaseUrl], {
    env: { ...process.env, ...(password ? { PGPASSWORD: password } : {}) }
  });
}

async function confirmDestructiveSchema(rl, databaseName) {
  const answer = await rl.question(
    `Database "${databaseName}" already exists. db.sql drops and recreates application tables. Apply it anyway? [y/N] `
  );
  if (!/^y(es)?$/i.test(answer.trim())) {
    throw new Error("Schema application cancelled; the existing database was not changed.");
  }
}

async function setupDatabase(rl) {
  const enteredName = await rl.question("Company name (e.g. Acme): ");
  if (!enteredName.trim()) throw new Error("Company name cannot be blank.");
  const databaseName = normalizeCompanyName(enteredName);
  const targetInput = await rl.question("Database target [local|aiven] (default: local): ");
  const target = targetInput.trim().toLowerCase() || "local";
  if (target !== "local" && target !== "aiven") {
    throw new Error('Database target must be either "local" or "aiven".');
  }

  const psql = await ensurePsql(target);
  let envText;
  try {
    envText = await readFile(envPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    envText = "";
  }
  const envValues = parse(envText);
  let adminUrl;
  let databaseUrl;
  let password;

  if (target === "local") {
    await ensurePostgresRunning();
    const passwordInput = await rl.question("Local PostgreSQL superuser password (default: postgres): ");
    password = passwordInput || "postgres";
    adminUrl = new URL("postgresql://postgres@127.0.0.1:5432/postgres");
    databaseUrl = setDatabaseName(adminUrl, databaseName);
    adminUrl.searchParams.set("connect_timeout", "10");
    databaseUrl.searchParams.set("connect_timeout", "10");
    if (password) {
      adminUrl.password = password;
      databaseUrl.password = password;
    }
  } else {
    const baseUrl = getAivenBaseUrl(envValues);
    adminUrl = setDatabaseName(baseUrl, "defaultdb");
    databaseUrl = setDatabaseName(baseUrl, databaseName);
  }

  const existing = await run(psql, [
    "-w", "-v", "ON_ERROR_STOP=1", "-At",
    "-c", `SELECT 1 FROM pg_database WHERE datname = '${databaseName}'`,
    adminUrl.toString()
  ], {
    env: { ...process.env, ...(password ? { PGPASSWORD: password } : {}) },
    quiet: true
  });

  if (existing.split(/\r?\n/).includes("1")) {
    console.log(`Database "${databaseName}" already exists; skipping CREATE DATABASE.`);
    await confirmDestructiveSchema(rl, databaseName);
  } else {
    await runPsql(psql, adminUrl.toString(), [
      "-c", `CREATE DATABASE "${databaseName}"`
    ], password);
  }

  console.log(`Applying db.sql to "${databaseName}"...`);
  await runPsql(psql, databaseUrl.toString(), ["-f", schemaPath], password);

  const updatedEnv = updateEnvText(envText, {
    DATABASE_TARGET: target,
    [target === "local" ? "DATABASE_URL_LOCAL" : "DATABASE_URL_AIVEN"]: databaseUrl.toString()
  });
  await writeFile(envPath, updatedEnv, "utf8");
  console.log(`Database setup complete. Updated ${envPath}.`);
}

async function main() {
  if (!["linux", "win32"].includes(process.platform)) {
    throw new Error("Database setup is supported only for Linux and Windows builds.");
  }
  await access(schemaPath);
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    await setupDatabase(rl);
  } finally {
    rl.close();
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    console.error(`Database setup failed: ${error.message}`);
    process.exitCode = 1;
  });
}
