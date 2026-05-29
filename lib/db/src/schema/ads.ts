import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

export const adsTable = pgTable("ads", {
  id: serial("id").primaryKey(),
  advertiserName: text("advertiser_name").notNull(),
  advertiserPhone: text("advertiser_phone").notNull(),
  message: text("message").notNull(),
  image: text("image"),
  videoPath: text("video_path"),
  startDate: timestamp("start_date", { withTimezone: true }).notNull().defaultNow(),
  endDate: timestamp("end_date", { withTimezone: true }).notNull(),
});

export type Ad = typeof adsTable.$inferSelect;
