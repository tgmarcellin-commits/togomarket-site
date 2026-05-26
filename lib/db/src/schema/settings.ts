import { pgTable, serial, integer } from "drizzle-orm/pg-core";

export const platformSettingsTable = pgTable("platform_settings", {
  id: serial("id").primaryKey(),
  commissionRate: integer("commission_rate").notNull().default(2),
});
