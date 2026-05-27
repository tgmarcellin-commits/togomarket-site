import { pgTable, serial, integer, text } from "drizzle-orm/pg-core";

export const platformSettingsTable = pgTable("platform_settings", {
  id: serial("id").primaryKey(),
  commissionRate: integer("commission_rate").notNull().default(2),
  publishCode: text("publish_code").notNull().default("TOGO2026"),
});
