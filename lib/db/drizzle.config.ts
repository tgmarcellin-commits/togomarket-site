import { defineConfig } from "drizzle-kit";
import path from "path";

const databaseUrl =
  process.env.NODE_ENV === "production"
    ? process.env.DATABASE_URL ?? process.env.TOGOMARKET_DATABASE_URL
    : process.env.TOGOMARKET_DATABASE_URL ?? process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "A PostgreSQL connection is required. Configure DATABASE_URL or TOGOMARKET_DATABASE_URL",
  );
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
