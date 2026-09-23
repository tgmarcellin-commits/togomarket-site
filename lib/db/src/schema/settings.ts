import { pgTable, serial, integer, text } from "drizzle-orm/pg-core";

export const platformSettingsTable = pgTable("platform_settings", {
  id: serial("id").primaryKey(),
  commissionRate: integer("commission_rate").notNull().default(2),
  whatsappCommission: text("whatsapp_commission").notNull().default("22870703131"),
  whatsappOrders: text("whatsapp_orders").notNull().default("22870703131"),
  subAdminPassword: text("sub_admin_password").notNull().default("0101"),
  whatsappAds: text("whatsapp_ads").notNull().default("22870703131"),
  whatsappServices: text("whatsapp_services").notNull().default("22870703131"),
  otpProvider: text("otp_provider").notNull().default("WHATSAPP"),
  whatsappValidation: text("whatsapp_validation").notNull().default("22870703131"),
  adVideoPlaybackMode: text("ad_video_playback_mode").notNull().default("AUTOPLAY"),
  buyerWithdrawalPerOperationLimit: integer("buyer_withdrawal_per_operation_limit").notNull().default(50000),
  buyerWithdrawalDailyCumulativeLimit: integer("buyer_withdrawal_daily_cumulative_limit").notNull().default(100000),
  buyerWithdrawalMonthlyRollingLimit: integer("buyer_withdrawal_monthly_rolling_limit").notNull().default(500000),
  haversineCorrectionCoefficientPermille: integer("haversine_correction_coefficient_permille").notNull().default(1250),
  orsApiUrl: text("ors_api_url").notNull().default("https://api.openrouteservice.org/v2/directions/driving-car"),
});
