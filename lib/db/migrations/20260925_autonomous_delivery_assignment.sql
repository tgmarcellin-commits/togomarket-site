ALTER TABLE drivers
ADD COLUMN IF NOT EXISTS coverage_zone text;

ALTER TABLE delivery_jobs
DROP CONSTRAINT IF EXISTS delivery_jobs_order_unique;

WITH ranked_jobs AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY order_id, driver_id
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM delivery_jobs
)
DELETE FROM delivery_jobs
WHERE id IN (
  SELECT id FROM ranked_jobs WHERE rn > 1
);

ALTER TABLE delivery_jobs
ADD CONSTRAINT delivery_jobs_order_driver_unique UNIQUE (order_id, driver_id);

CREATE TABLE IF NOT EXISTS conversation_delivery_orders (
  id serial PRIMARY KEY,
  conversation_id integer NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  order_id integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_delivery_orders_conversation_unique UNIQUE (conversation_id),
  CONSTRAINT conversation_delivery_orders_order_unique UNIQUE (order_id)
);

CREATE TABLE IF NOT EXISTS order_price_confirmations (
  id serial PRIMARY KEY,
  conversation_id integer NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  actor_type text NOT NULL,
  amount_fcfa integer NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_price_confirmations_conversation_actor_unique UNIQUE (conversation_id, actor_type)
);
