import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { vendorsTable } from "./vendors";

export const marketplaceWalletsTable = pgTable("marketplace_wallets", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id")
    .notNull()
    .unique()
    .references(() => vendorsTable.id, { onDelete: "cascade" }),
  availableBalanceFcfa: integer("available_balance_fcfa").notNull().default(0),
  pendingBalanceFcfa: integer("pending_balance_fcfa").notNull().default(0),
  totalPaidOutFcfa: integer("total_paid_out_fcfa").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const marketplaceLedgerTable = pgTable("marketplace_ledger", {
  id: serial("id").primaryKey(),
  walletId: integer("wallet_id")
    .notNull()
    .references(() => marketplaceWalletsTable.id, { onDelete: "cascade" }),
  direction: text("direction").notNull(), // credit | debit
  amountFcfa: integer("amount_fcfa").notNull(),
  balanceAfterFcfa: integer("balance_after_fcfa").notNull(),
  reason: text("reason").notNull(),
  referenceType: text("reference_type").notNull(),
  referenceId: text("reference_id").notNull(),
  idempotencyKeyHash: text("idempotency_key_hash").notNull(),
  createdBy: text("created_by").notNull().default("system"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqueIdempotencyByWallet: uniqueIndex("marketplace_ledger_wallet_idempotency_unique").on(t.walletId, t.idempotencyKeyHash),
  walletCreatedAtIdx: index("marketplace_ledger_wallet_created_at_idx").on(t.walletId, t.createdAt),
}));

export const marketplaceOrdersTable = pgTable("marketplace_orders", {
  id: serial("id").primaryKey(),
  publicId: text("public_id").notNull().unique(),
  vendorId: integer("vendor_id")
    .notNull()
    .references(() => vendorsTable.id, { onDelete: "restrict" }),
  buyerName: text("buyer_name").notNull(),
  buyerPhone: text("buyer_phone").notNull(),
  amountFcfa: integer("amount_fcfa").notNull(),
  status: text("status").notNull().default("pending"),
  returnStatus: text("return_status").notNull().default("none"),
  disputeStatus: text("dispute_status").notNull().default("none"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const deliveryDriversTable = pgTable("delivery_drivers", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id")
    .notNull()
    .references(() => vendorsTable.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  phone: text("phone").notNull(),
  isAvailable: boolean("is_available").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqueVendorPhone: uniqueIndex("delivery_drivers_vendor_phone_unique").on(t.vendorId, t.phone),
}));

export const deliveryDriverSessionsTable = pgTable("delivery_driver_sessions", {
  id: serial("id").primaryKey(),
  driverId: integer("driver_id")
    .notNull()
    .references(() => deliveryDriversTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const deliveryJobsTable = pgTable("delivery_jobs", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id")
    .notNull()
    .references(() => marketplaceOrdersTable.id, { onDelete: "cascade" }),
  driverId: integer("driver_id")
    .references(() => deliveryDriversTable.id, { onDelete: "set null" }),
  status: text("status").notNull().default("pending_assignment"),
  pickupConfirmedAt: timestamp("pickup_confirmed_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  returnConfirmedAt: timestamp("return_confirmed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const deliveryQrTokensTable = pgTable("delivery_qr_tokens", {
  id: serial("id").primaryKey(),
  deliveryJobId: integer("delivery_job_id")
    .notNull()
    .references(() => deliveryJobsTable.id, { onDelete: "cascade" }),
  orderId: integer("order_id")
    .notNull()
    .references(() => marketplaceOrdersTable.id, { onDelete: "cascade" }),
  actorRole: text("actor_role").notNull(), // buyer | seller | driver
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  consumedByRole: text("consumed_by_role"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const withdrawalTicketsTable = pgTable("withdrawal_tickets", {
  id: serial("id").primaryKey(),
  walletId: integer("wallet_id")
    .notNull()
    .references(() => marketplaceWalletsTable.id, { onDelete: "cascade" }),
  amountFcfa: integer("amount_fcfa").notNull(),
  status: text("status").notNull().default("pending"), // pending | approved | paid | failed
  fedapayPayoutId: text("fedapay_payout_id"),
  externalReference: text("external_reference").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqueExternalReference: uniqueIndex("withdrawal_tickets_external_ref_unique").on(t.externalReference),
}));

export const payoutWebhookEventsTable = pgTable("payout_webhook_events", {
  id: serial("id").primaryKey(),
  eventIdHash: text("event_id_hash").notNull().unique(),
  rawEventId: text("raw_event_id").notNull(),
  status: text("status").notNull().default("processed"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export const marketplaceDisputesTable = pgTable("marketplace_disputes", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id")
    .notNull()
    .references(() => marketplaceOrdersTable.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("open"), // open | accepted | rejected | refunded
  idempotencyKeyHash: text("idempotency_key_hash").notNull(),
  openedBy: text("opened_by").notNull(),
  resolvedBy: text("resolved_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, (t) => ({
  uniqueOrderIdempotency: uniqueIndex("marketplace_disputes_order_idempotency_unique").on(t.orderId, t.idempotencyKeyHash),
}));

export const marketplaceRefundsTable = pgTable("marketplace_refunds", {
  id: serial("id").primaryKey(),
  disputeId: integer("dispute_id")
    .notNull()
    .references(() => marketplaceDisputesTable.id, { onDelete: "cascade" }),
  orderId: integer("order_id")
    .notNull()
    .references(() => marketplaceOrdersTable.id, { onDelete: "cascade" }),
  amountFcfa: integer("amount_fcfa").notNull(),
  status: text("status").notNull().default("pending"), // pending | processed | failed
  idempotencyKeyHash: text("idempotency_key_hash").notNull().unique(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLogsTable = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id").notNull(),
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
