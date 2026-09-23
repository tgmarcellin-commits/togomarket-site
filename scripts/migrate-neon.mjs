#!/usr/bin/env node
// Copy a PostgreSQL database into an empty or explicitly replaceable Neon database.
// URLs must be supplied as SOURCE_DATABASE_URL and TARGET_DATABASE_URL secrets.
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const query = `
SELECT n.nspname || '.' || c.relname || '=' ||
       (xpath('/row/count/text()', query_to_xml(
         format('SELECT count(*) FROM %I.%I', n.nspname, c.relname),
         false, true, ''
       )))[1]::text
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'
ORDER BY n.nspname, c.relname;
`;

const objectQuery = `
SELECT count(*) FROM (
  SELECT c.oid FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg_toast%'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
  UNION ALL
  SELECT p.oid FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg_toast%'
  UNION ALL
  SELECT t.oid FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg_toast%'
      AND t.typrelid = 0 AND t.typisdefined
      AND t.typtype IN ('c', 'd', 'e', 'r', 'm')
) objects;
`;
const extensionQuery = `
SELECT e.extname || '@' || n.nspname
FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
ORDER BY e.extname;`;

const schemaQuery = `
SELECT nspname FROM pg_namespace
WHERE nspname NOT IN ('pg_catalog', 'information_schema')
  AND nspname NOT LIKE 'pg_toast%'
ORDER BY nspname;`;

function connectionEnv(value) {
  if (!value) throw new Error("SOURCE_DATABASE_URL and TARGET_DATABASE_URL must both be set as secrets.");
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol.toLowerCase())) {
    throw new Error("Expected a PostgreSQL connection URL.");
  }
  const params = url.searchParams;
  const sslmode = params.get("sslmode");
  if (sslmode !== "require" && sslmode !== "verify-full") {
    throw new Error("Connection URLs must explicitly require TLS (sslmode=require or verify-full).");
  }
  return {
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: sslmode,
    PGCHANNELBINDING: params.get("channel_binding") || "prefer",
    PGCONNECT_TIMEOUT: "15",
  };
}

function run(command, args, connection, capture = false) {
  return new Promise((resolve, reject) => {
    const executable = process.env.PG_BIN_DIR ? join(process.env.PG_BIN_DIR, command) : command;
    const child = spawn(executable, args, {
      env: { ...process.env, ...connection },
      stdio: ["ignore", capture ? "pipe" : "inherit", "pipe"],
    });
    let output = "";
    let error = "";
    if (capture) child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { error += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(output.trim());
      else reject(new Error(`${command} failed (exit ${code}): ${error.trim()}`));
    });
  });
}

const psql = (connection, sql) =>
  run("psql", ["-X", "-w", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql], connection, true);

async function main() {
  const mode = process.argv[2];
  if (!["--check", "--migrate", "--replace-target"].includes(mode) || process.argv.length !== 3) {
    throw new Error("Usage: node scripts/migrate-neon.mjs --check|--migrate|--replace-target");
  }
  const source = connectionEnv(process.env.SOURCE_DATABASE_URL);
  const target = connectionEnv(process.env.TARGET_DATABASE_URL);
  if (source.PGHOST === target.PGHOST && source.PGDATABASE === target.PGDATABASE) {
    throw new Error("Source and target point to the same database.");
  }
  const [sourceVersion, targetVersion, targetObjects] = await Promise.all([
    psql(source, "SHOW server_version;"),
    psql(target, "SHOW server_version;"),
    psql(target, objectQuery),
  ]);
  const targetObjectCount = Number(targetObjects);
  console.log(`Source PostgreSQL: ${sourceVersion}; target PostgreSQL: ${targetVersion}.`);
  console.log(`Target existing user objects: ${targetObjectCount}.`);
  const clientVersion = await run("pg_dump", ["--version"], source, true);
  if (Number(clientVersion.match(/(\d+)\./)?.[1]) < Number(targetVersion.match(/^(\d+)/)?.[1])) {
    throw new Error(`pg_dump ${clientVersion} cannot back up target PostgreSQL ${targetVersion}. Set PG_BIN_DIR to PostgreSQL 18 client binaries.`);
  }
  const sourceRows = await psql(source, query);
  console.log(`Source tables: ${sourceRows ? sourceRows.split("\n").length : 0}.`);
  if (targetObjectCount !== 0 && mode !== "--replace-target") {
    const targetRows = await psql(target, query);
    console.log(`Source table row counts:\n${sourceRows || "(none)"}`);
    console.log(`Target tables: ${targetRows ? targetRows.split("\n").length : 0}.`);
    console.log(`Target table row counts:\n${targetRows || "(none)"}`);
    console.log(`Source extensions: ${await psql(source, extensionQuery)}; target extensions: ${await psql(target, extensionQuery)}.`);
    console.log(`Source schemas: ${await psql(source, schemaQuery)}; target schemas: ${await psql(target, schemaQuery)}.`);
    throw new Error("Target is not empty. No changes made; do not overwrite existing objects without a separate review.");
  }
  if (mode === "--check") {
    console.log("Preflight OK: target empty; ready for --migrate.");
    return;
  }

  const tempDir = await mkdtemp(join(tmpdir(), "neon-migration-"));
  try {
    const archive = join(tempDir, "database.dump");
    if (mode === "--replace-target") {
      const backupDir = join(".local", "backups");
      await mkdir(backupDir, { recursive: true, mode: 0o700 });
      const backup = join(backupDir, `neon-target-before-migration-${new Date().toISOString().replace(/[:.]/g, "-")}.dump`);
      console.log("Backing up existing target before any changes...");
      await run("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--file", backup], target);
      await chmod(backup, 0o600);
      await run("pg_restore", ["--file", "/dev/null", backup], target);
      console.log(`Target backup verified: ${backup}`);
    }
    console.log("Creating consistent source dump...");
    await run("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--file", archive], source);
    await run("pg_restore", ["--file", "/dev/null", archive], source);
    // Re-check immediately before restoring; the restore itself is one transaction.
    if (Number(await psql(target, objectQuery)) !== targetObjectCount) {
      throw new Error("Target changed after preflight; refusing to restore.");
    }
    console.log(mode === "--replace-target" ? "Replacing target atomically..." : "Restoring into empty target...");
    await run("pg_restore", [
      "--exit-on-error", "--single-transaction", "--no-owner", "--no-acl",
      ...(mode === "--replace-target" ? ["--clean", "--if-exists"] : []),
      "--dbname", target.PGDATABASE, archive,
    ], target);
    const targetRows = await psql(target, query);
    if (targetRows !== sourceRows) {
      throw new Error("Restore finished but table row counts differ. Inspect target before using it.");
    }
    console.log(`Migration verified: ${sourceRows ? sourceRows.split("\n").length : 0} tables, matching row counts.`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});