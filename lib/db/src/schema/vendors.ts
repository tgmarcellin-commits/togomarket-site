import { pgTable, text, serial, timestamp, boolean, integer } from "drizzle-orm/pg-core";

export const vendorsTable = pgTable("vendors", {
  id: serial("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  phone: text("phone").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  profilePhoto: text("profile_photo"),
  verified: boolean("verified").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiryDate: timestamp("expiry_date", { withTimezone: true }),
  isPublished: boolean("is_published").notNull().default(false),
  paymentStatus: text("payment_status").notNull().default("unpaid"),
  fedapayTransactionId: text("fedapay_transaction_id"),
  validationMethod: text("validation_method").notNull().default("pending"),
  referralDaysEarned: integer("referral_days_earned").notNull().default(0),
  referredBy: integer("referred_by"),
  shopName: text("shop_name"),
  wantsNotifications: boolean("wants_notifications").notNull().default(true),
});

export const publishCodesTable = pgTable("publish_codes", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id")
    .notNull()
    .references(() => vendorsTable.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  startDate: timestamp("start_date", { withTimezone: true }).notNull(),
  endDate: timestamp("end_date", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const adminAccountsTable = pgTable("admin_accounts", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  role: text("role").notNull(),
  codeHash: text("code_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const otpCodesTable = pgTable("otp_codes", {
  id: serial("id").primaryKey(),
  phone: text("phone").notNull(),
  code: text("code").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  used: boolean("used").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Vendor = typeof vendorsTable.$inferSelect;
export type PublishCode = typeof publishCodesTable.$inferSelect;
export type AdminAccount = typeof adminAccountsTable.$inferSelect;
export type OtpCode = typeof otpCodesTable.$inferSelect;
