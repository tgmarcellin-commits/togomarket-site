-- Migration: 20261002_delivery_payment_timeout.sql
-- Adds support for the 10-minute driver-acceptance payment timeout:
--   * a new acceptance status for jobs cancelled because the buyer never paid
--   * a cancel_reason trail on delivery_jobs
--   * an explicit marker on orders for when the driver's payment was confirmed

ALTER TYPE delivery_acceptance_status ADD VALUE IF NOT EXISTS 'cancelled_payment_timeout';

ALTER TABLE delivery_jobs ADD COLUMN IF NOT EXISTS cancel_reason text;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS driver_payment_confirmed_at timestamptz;
