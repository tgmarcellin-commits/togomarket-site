-- Migration: 20261002_delivery_payment_timeout.sql
-- Adds support for the 10-minute driver-acceptance payment timeout:
--   * a new acceptance status for jobs cancelled because the buyer never paid
--   * a cancel_reason trail on delivery_jobs
--   * an explicit marker on orders for when the driver's payment was confirmed
--
-- IMPORTANT: run this file on its own (e.g. `psql -f ...`), not concatenated
-- with other migrations inside a single explicit transaction block. Postgres
-- does not allow a value added by `ALTER TYPE ... ADD VALUE` to be used by
-- statements in the same transaction that added it.

ALTER TYPE delivery_acceptance_status ADD VALUE IF NOT EXISTS 'cancelled_payment_timeout';

ALTER TABLE delivery_jobs ADD COLUMN IF NOT EXISTS cancel_reason text;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS driver_payment_confirmed_at timestamptz;

CREATE INDEX IF NOT EXISTS delivery_jobs_acceptance_status_accepted_at_idx
  ON delivery_jobs (acceptance_status, accepted_at);

CREATE INDEX IF NOT EXISTS orders_status_payment_confirmed_idx
  ON orders (status, driver_payment_confirmed_at);
