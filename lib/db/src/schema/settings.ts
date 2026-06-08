import { pgTable, serial, integer, text } from "drizzle-orm/pg-core";

export const platformSettingsTable = pgTable("platform_settings", {
  id: serial("id").primaryKey(),
  commissionRate: integer("commission_rate").notNull().default(2),
  whatsappCommission: text("whatsapp_commission").notNull().default("22870703131"),
  whatsappOrders: text("whatsapp_orders").notNull().default("22870703131"),
  subAdminPassword: text("sub_admin_password").notNull().default("0101"),
});
