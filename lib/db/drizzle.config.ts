import { defineConfig } from "drizzle-kit";
import path from "path";

const databaseUrl = process.env.TOGOMARKET_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("TOGOMARKET_DATABASE_URL, ensure the TogoMarket database secret is configured");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
