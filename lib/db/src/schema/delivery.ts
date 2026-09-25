import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { ordersTable } from "./orders";
import { vendorsTable } from "./vendors";
import { conversationsTable } from "./chat";

export const acceptanceStatusEnum = pgEnum("delivery_acceptance_status", [
  "pending_driver_response",
  "accepted_by_driver",
  "refused_by_driver",
  "expired",
  "cancelled_by_reassignment",
]);

export const walletOwnerTypeEnum = pgEnum("wallet_owner_type", ["seller", "driver", "buyer"]);
export const withdrawalStatusEnum = pgEnum("withdrawal_status", [
  "pending_otp",
  "otp_verified",
  "withdrawal_reserved",
  "withdrawal_review_required",
  "sent",
  "failed",
  "cancelled",
]);
export const whatsappDeliveryStatusEnum = pgEnum("whatsapp_delivery_status", ["sent", "failed", "fallback_triggered"]);

export const driversTable = pgTable("drivers", {
  id: serial("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  phone: text("phone").notNull().unique(),
  photoUrl: text("photo_url"),
  coverageZone: text("coverage_zone"),
  whatsappNumber: text("whatsapp_number"),
  isAvailable: boolean("is_available").notNull().default(true),
  otpSessionTokenHash: text("otp_session_token_hash"),
  otpSessionExpiresAt: timestamp("otp_session_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const deliveryWorkflowJobsTable = pgTable(
  "delivery_jobs",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "cascade" }),
    driverId: integer("driver_id")
      .notNull()
      .references(() => driversTable.id, { onDelete: "cascade" }),
    acceptanceStatus: acceptanceStatusEnum("acceptance_status").notNull().default("pending_driver_response"),
    assignmentExpiresAt: timestamp("assignment_expires_at", { withTimezone: true }),
    whatsappNotifiedAt: timestamp("whatsapp_notified_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    refusedAt: timestamp("refused_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueOrderDriverAssignment: unique("delivery_jobs_order_driver_unique").on(t.orderId, t.driverId),
    orderStatusIdx: index("delivery_jobs_order_status_idx").on(t.orderId, t.acceptanceStatus),
  }),
);

export const conversationDeliveryOrdersTable = pgTable(
  "conversation_delivery_orders",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversationsTable.id, { onDelete: "cascade" }),
    orderId: integer("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueConversationOrder: unique("conversation_delivery_orders_conversation_unique").on(t.conversationId),
    uniqueOrderConversation: unique("conversation_delivery_orders_order_unique").on(t.orderId),
  }),
);

export const orderPriceConfirmationsTable = pgTable(
  "order_price_confirmations",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversationsTable.id, { onDelete: "cascade" }),
    actorType: text("actor_type").notNull(),
    amountFcfa: integer("amount_fcfa").notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueConversationActor: unique("order_price_confirmations_conversation_actor_unique").on(
      t.conversationId,
      t.actorType,
    ),
  }),
);

export const virtualWalletsTable = pgTable(
  "virtual_wallets",
  {
    id: serial("id").primaryKey(),
    ownerType: walletOwnerTypeEnum("owner_type").notNull(),
    ownerId: integer("owner_id").notNull(),
    balance: bigint("balance", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ownerUnique: uniqueIndex("virtual_wallets_owner_unique").on(t.ownerType, t.ownerId),
    buyerNeverNegative: check(
      "virtual_wallets_buyer_non_negative",
      sql`(${t.ownerType} <> 'buyer'::wallet_owner_type OR ${t.balance} >= 0)`,
    ),
  }),
);

export const walletLedgerTable = pgTable("wallet_ledger", {
  id: serial("id").primaryKey(),
  walletId: integer("wallet_id")
    .notNull()
    .references(() => virtualWalletsTable.id, { onDelete: "cascade" }),
  orderId: integer("order_id").references(() => ordersTable.id, { onDelete: "set null" }),
  entryType: text("entry_type").notNull(),
  amount: bigint("amount", { mode: "number" }).notNull(),
  direction: text("direction").notNull(), // debit | credit
  immutableHash: text("immutable_hash").notNull().unique(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ledgerAccountsTable = pgTable("ledger_accounts", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  accountType: text("account_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ledgerEntriesTable = pgTable("ledger_entries", {
  id: serial("id").primaryKey(),
  journalReference: text("journal_reference").notNull(),
  debitAccountId: integer("debit_account_id")
    .notNull()
    .references(() => ledgerAccountsTable.id, { onDelete: "restrict" }),
  creditAccountId: integer("credit_account_id")
    .notNull()
    .references(() => ledgerAccountsTable.id, { onDelete: "restrict" }),
  amount: bigint("amount", { mode: "number" }).notNull(),
  description: text("description").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const deliveryWithdrawalTicketsTable = pgTable("withdrawal_tickets", {
  id: serial("id").primaryKey(),
  ownerType: walletOwnerTypeEnum("owner_type").notNull(),
  ownerId: integer("owner_id").notNull(),
  walletId: integer("wallet_id")
    .notNull()
    .references(() => virtualWalletsTable.id, { onDelete: "cascade" }),
  phoneNumber: text("phone_number").notNull(),
  amount: bigint("amount", { mode: "number" }).notNull(),
  dailyCumulativeAmount: bigint("daily_cumulative_amount", { mode: "number" }).notNull().default(0),
  monthlyCumulativeAmount: bigint("monthly_cumulative_amount", { mode: "number" }).notNull().default(0),
  status: withdrawalStatusEnum("status").notNull().default("pending_otp"),
  otpCodeHash: text("otp_code_hash"),
  otpExpiresAt: timestamp("otp_expires_at", { withTimezone: true }),
  reviewReason: text("review_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const payoutsFedapayTable = pgTable("payouts_fedapay", {
  id: serial("id").primaryKey(),
  withdrawalTicketId: integer("withdrawal_ticket_id")
    .references(() => deliveryWithdrawalTicketsTable.id, { onDelete: "set null" }),
  fedapayPayoutId: text("fedapay_payout_id"),
  merchantReference: text("merchant_reference").notNull().unique(),
  transactionId: text("transaction_id"),
  status: text("status").notNull().default("pending"),
  amount: bigint("amount", { mode: "number" }).notNull(),
  customMetadata: jsonb("custom_metadata"),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const paymentWebhooksTable = pgTable("payment_webhooks", {
  id: serial("id").primaryKey(),
  eventHash: text("event_hash").notNull().unique(),
  provider: text("provider").notNull().default("fedapay_marketplace"),
  eventName: text("event_name").notNull(),
  payload: jsonb("payload").notNull(),
  processed: boolean("processed").notNull().default(false),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const qrTokensTable = pgTable("qr_tokens", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id")
    .notNull()
    .references(() => ordersTable.id, { onDelete: "cascade" }),
  driverId: integer("driver_id")
    .notNull()
    .references(() => driversTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  sessionId: text("session_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ratingsTable = pgTable("ratings", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id")
    .notNull()
    .references(() => ordersTable.id, { onDelete: "cascade" }),
  buyerPhone: text("buyer_phone").notNull(),
  stars: integer("stars").notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const disputesTable = pgTable("disputes", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id")
    .notNull()
    .references(() => ordersTable.id, { onDelete: "cascade" }),
  openedByType: text("opened_by_type").notNull(),
  openedById: integer("opened_by_id"),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("open"),
  refundId: text("refund_id"),
  transactionId: text("transaction_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const deliveryAuditLogsTable = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id"),
  action: text("action").notNull(),
  orderId: integer("order_id").references(() => ordersTable.id, { onDelete: "set null" }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const adminAlertsTable = pgTable("admin_alerts", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(),
  severity: text("severity").notNull().default("warning"),
  title: text("title").notNull(),
  message: text("message").notNull(),
  metadata: jsonb("metadata"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const whatsappNotificationsTable = pgTable("whatsapp_notifications", {
  id: serial("id").primaryKey(),
  recipientPhone: text("recipient_phone").notNull(),
  messageContent: text("message_content").notNull(),
  deliveryStatus: whatsappDeliveryStatusEnum("delivery_status").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  providerResponse: jsonb("provider_response"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const locationsTable = pgTable("locations", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id")
    .notNull()
    .references(() => ordersTable.id, { onDelete: "cascade" }),
  actorType: text("actor_type").notNull(),
  actorId: integer("actor_id"),
  latitude: integer("latitude_microdeg").notNull(),
  longitude: integer("longitude_microdeg").notNull(),
  accuracyMeters: integer("accuracy_meters"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const deliveryConsentsTable = pgTable("delivery_consents", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id")
    .notNull()
    .references(() => ordersTable.id, { onDelete: "cascade" }),
  buyerConsented: boolean("buyer_consented").notNull().default(false),
  sellerConsented: boolean("seller_consented").notNull().default(false),
  buyerConsentedAt: timestamp("buyer_consented_at", { withTimezone: true }),
  sellerConsentedAt: timestamp("seller_consented_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const driverSessionsTable = pgTable("driver_sessions", {
  id: serial("id").primaryKey(),
  driverId: integer("driver_id")
    .notNull()
    .references(() => driversTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sellerDriverBindingsTable = pgTable("seller_driver_bindings", {
  id: serial("id").primaryKey(),
  sellerVendorId: integer("seller_vendor_id")
    .notNull()
    .references(() => vendorsTable.id, { onDelete: "cascade" }),
  driverId: integer("driver_id")
    .notNull()
    .references(() => driversTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
