import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const databaseUrl = process.env.TOGOMARKET_DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "TOGOMARKET_DATABASE_URL must be set. Did you configure the TogoMarket database secret?",
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
