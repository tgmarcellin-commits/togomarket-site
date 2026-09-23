import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// Replit injects DATABASE_URL for the managed production database. The
// project-specific secret is kept as a development/legacy fallback so a
// stale external connection cannot override production data.
const databaseUrl =
  process.env.NODE_ENV === "production"
    ? process.env.DATABASE_URL ?? process.env.TOGOMARKET_DATABASE_URL
    : process.env.TOGOMARKET_DATABASE_URL ?? process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "A PostgreSQL connection is required. Configure DATABASE_URL or TOGOMARKET_DATABASE_URL.",
  );
}

export const pool = new Pool({
  connectionString: databaseUrl,
  keepAlive: true,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  max: 10,
});

pool.on("error", (err) => {
  console.error("Unexpected database pool error:", err);
});

export const db = drizzle(pool, { schema });

export * from "./schema";
