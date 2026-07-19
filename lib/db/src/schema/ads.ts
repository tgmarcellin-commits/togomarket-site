import { pgTable, text, serial, timestamp, boolean } from "drizzle-orm/pg-core";

// Catégories disponibles pour les publicités
export const AD_CATEGORIES = ["Agence", "Ecole", "Hotels", "Restaurant"] as const;
export type AdCategory = typeof AD_CATEGORIES[number];

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
  // Catégorie de la publicité : Agence, Ecole, Hotels, Restaurant
  // Les pubs existantes sans catégorie sont automatiquement dans "Agence" (valeur par défaut)
  category: text("category").notNull().default("Agence"),
});

export type Ad = typeof adsTable.$inferSelect;
