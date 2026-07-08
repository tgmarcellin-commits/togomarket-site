import { pgTable, text, serial, timestamp, boolean } from "drizzle-orm/pg-core";

export const adsTable = pgTable("ads", {
  id: serial("id").primaryKey(),
  advertiserName: text("advertiser_name").notNull(),
  advertiserPhone: text("advertiser_phone").notNull(),
  message: text("message").notNull(),
  image: text("image"),
  videoPath: text("video_path"),
  startDate: timestamp("start_date", { withTimezone: true }).notNull().defaultNow(),
  endDate: timestamp("end_date", { withTimezone: true }).notNull(),
  isPublished: boolean("is_published").notNull().default(false),
  paymentStatus: text("payment_status").notNull().default("unpaid"),
  validationMethod: text("validation_method").notNull().default("pending"),
  fedapayTransactionId: text("fedapay_transaction_id"),
});

export type Ad = typeof adsTable.$inferSelect;
