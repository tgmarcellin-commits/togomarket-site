-- Migration: 20261001_phase1_delivery_foundation.sql
-- Backend delivery, QR, settlement, wallets, and double-entry accounting foundation

-- 1. Create enums if not exist
DO $$ BEGIN
  CREATE TYPE delivery_acceptance_status AS ENUM (
    'pending_driver_response',
    'accepted_by_driver',
    'refused_by_driver',
    'expired',
    'cancelled_by_reassignment'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE wallet_owner_type AS ENUM ('seller', 'driver', 'buyer');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE withdrawal_status AS ENUM (
    'pending_otp',
    'otp_verified',
    'withdrawal_reserved',
    'withdrawal_review_required',
    'sent',
    'failed',
    'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE whatsapp_delivery_status AS ENUM ('sent', 'failed', 'fallback_triggered');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2. Drivers table enhancements
CREATE TABLE IF NOT EXISTS drivers (
  id serial PRIMARY KEY,
  first_name text NOT NULL,
  last_name text NOT NULL,
  phone text NOT NULL UNIQUE,
  photo_url text,
  coverage_zone text,
  work_zone text,
  id_document_number text,
  id_document_photo_url text,
  is_active boolean NOT NULL DEFAULT true,
  whatsapp_number text,
  is_available boolean NOT NULL DEFAULT true,
  otp_session_token_hash text,
  otp_session_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS coverage_zone text;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS work_zone text;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS id_document_number text;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS id_document_photo_url text;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- 3. Delivery jobs table
CREATE TABLE IF NOT EXISTS delivery_jobs (
  id serial PRIMARY KEY,
  order_id integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  driver_id integer NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  acceptance_status delivery_acceptance_status NOT NULL DEFAULT 'pending_driver_response',
  assignment_expires_at timestamptz,
  whatsapp_notified_at timestamptz,
  accepted_at timestamptz,
  refused_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_jobs_order_driver_unique UNIQUE (order_id, driver_id)
);
CREATE INDEX IF NOT EXISTS delivery_jobs_order_status_idx ON delivery_jobs (order_id, acceptance_status);

-- 4. Orders table enhancements
ALTER TABLE orders ADD COLUMN IF NOT EXISTS round_trip_fee_locked integer;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS settlement_status text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS settled_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS settlement_ref text;

-- 5. Delivery locations table
CREATE TABLE IF NOT EXISTS delivery_locations (
  id serial PRIMARY KEY,
  delivery_job_id integer REFERENCES delivery_jobs(id) ON DELETE CASCADE,
  order_id integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  driver_id integer NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  accuracy_meters double precision,
  speed double precision,
  heading double precision,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS delivery_locations_job_created_at_idx ON delivery_locations (delivery_job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS delivery_locations_order_created_at_idx ON delivery_locations (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS delivery_locations_driver_created_at_idx ON delivery_locations (driver_id, created_at DESC);

-- 6. QR tokens table enhancements
CREATE TABLE IF NOT EXISTS qr_tokens (
  id serial PRIMARY KEY,
  order_id integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  delivery_job_id integer REFERENCES delivery_jobs(id) ON DELETE CASCADE,
  driver_id integer NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  stage text NOT NULL DEFAULT 'delivery',
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  session_id text,
  scanned_by_role text,
  scanner_latitude double precision,
  scanner_longitude double precision,
  proximity_meters double precision,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE qr_tokens ADD COLUMN IF NOT EXISTS delivery_job_id integer REFERENCES delivery_jobs(id) ON DELETE CASCADE;
ALTER TABLE qr_tokens ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'delivery';
ALTER TABLE qr_tokens ADD COLUMN IF NOT EXISTS scanned_by_role text;
ALTER TABLE qr_tokens ADD COLUMN IF NOT EXISTS scanner_latitude double precision;
ALTER TABLE qr_tokens ADD COLUMN IF NOT EXISTS scanner_longitude double precision;
ALTER TABLE qr_tokens ADD COLUMN IF NOT EXISTS proximity_meters double precision;

-- 7. Virtual wallets table
CREATE TABLE IF NOT EXISTS virtual_wallets (
  id serial PRIMARY KEY,
  owner_type wallet_owner_type NOT NULL,
  owner_id integer NOT NULL,
  balance bigint NOT NULL DEFAULT 0,
  locked_balance bigint NOT NULL DEFAULT 0,
  pending_payout_balance bigint NOT NULL DEFAULT 0,
  paid_out_balance bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS virtual_wallets_owner_unique ON virtual_wallets (owner_type, owner_id);

ALTER TABLE virtual_wallets ADD COLUMN IF NOT EXISTS locked_balance bigint NOT NULL DEFAULT 0;
ALTER TABLE virtual_wallets ADD COLUMN IF NOT EXISTS pending_payout_balance bigint NOT NULL DEFAULT 0;
ALTER TABLE virtual_wallets ADD COLUMN IF NOT EXISTS paid_out_balance bigint NOT NULL DEFAULT 0;

-- 8. Wallet ledger table
CREATE TABLE IF NOT EXISTS wallet_ledger (
  id serial PRIMARY KEY,
  wallet_id integer NOT NULL REFERENCES virtual_wallets(id) ON DELETE CASCADE,
  order_id integer REFERENCES orders(id) ON DELETE SET NULL,
  entry_type text NOT NULL,
  amount bigint NOT NULL,
  direction text NOT NULL,
  balance_after bigint,
  settlement_ref text,
  immutable_hash text NOT NULL UNIQUE,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE wallet_ledger ADD COLUMN IF NOT EXISTS balance_after bigint;
ALTER TABLE wallet_ledger ADD COLUMN IF NOT EXISTS settlement_ref text;

-- 9. Double-entry ledger accounts and entries
CREATE TABLE IF NOT EXISTS ledger_accounts (
  id serial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  account_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id serial PRIMARY KEY,
  journal_reference text NOT NULL,
  debit_account_id integer NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
  credit_account_id integer NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
  amount bigint NOT NULL,
  description text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_entries_journal_reference_idx ON ledger_entries (journal_reference);

-- 10. Withdrawal tickets
CREATE TABLE IF NOT EXISTS withdrawal_tickets (
  id serial PRIMARY KEY,
  owner_type wallet_owner_type NOT NULL,
  owner_id integer NOT NULL,
  wallet_id integer NOT NULL REFERENCES virtual_wallets(id) ON DELETE CASCADE,
  phone_number text NOT NULL,
  amount bigint NOT NULL,
  daily_cumulative_amount bigint NOT NULL DEFAULT 0,
  monthly_cumulative_amount bigint NOT NULL DEFAULT 0,
  status withdrawal_status NOT NULL DEFAULT 'pending_otp',
  otp_code_hash text,
  otp_expires_at timestamptz,
  review_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 11. Payouts Fedapay
CREATE TABLE IF NOT EXISTS payouts_fedapay (
  id serial PRIMARY KEY,
  withdrawal_ticket_id integer REFERENCES withdrawal_tickets(id) ON DELETE SET NULL,
  fedapay_payout_id text,
  merchant_reference text NOT NULL UNIQUE,
  transaction_id text,
  status text NOT NULL DEFAULT 'pending',
  amount bigint NOT NULL,
  custom_metadata jsonb,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 12. Payment webhooks
CREATE TABLE IF NOT EXISTS payment_webhooks (
  id serial PRIMARY KEY,
  event_hash text NOT NULL UNIQUE,
  provider text NOT NULL DEFAULT 'fedapay_marketplace',
  event_name text NOT NULL,
  payload jsonb NOT NULL,
  processed boolean NOT NULL DEFAULT false,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 13. Audit logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id serial PRIMARY KEY,
  actor_type text NOT NULL,
  actor_id text,
  action text NOT NULL,
  order_id integer REFERENCES orders(id) ON DELETE SET NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 14. Driver sessions
CREATE TABLE IF NOT EXISTS driver_sessions (
  id serial PRIMARY KEY,
  driver_id integer NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 15. Orders table enhancements
ALTER TABLE orders ADD COLUMN IF NOT EXISTS article_price_locked integer NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS distance_locked_km integer;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS transport_fee_locked integer;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS round_trip_fee_locked integer;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS distance_actual_km integer;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS distance_source text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'PENDING';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS settlement_status text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS settled_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS settlement_ref text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS buyer_consent_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS seller_consent_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS buyer_consented boolean NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS seller_consented boolean NOT NULL DEFAULT false;

-- 16. Conversations & delivery mapping tables
CREATE TABLE IF NOT EXISTS vendors (
  id serial PRIMARY KEY,
  name text NOT NULL,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversations (
  id serial PRIMARY KEY,
  vendor_id integer NOT NULL,
  buyer_name text NOT NULL DEFAULT '',
  buyer_phone text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversation_delivery_orders (
  id serial PRIMARY KEY,
  conversation_id integer NOT NULL,
  order_id integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);


