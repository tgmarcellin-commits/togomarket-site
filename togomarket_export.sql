-- TogoMarket — Export SQL
-- Date: 2026-05-24T10:24:46.922Z

-- Table: listings
CREATE TABLE IF NOT EXISTS listings (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  price NUMERIC NOT NULL,
  location TEXT NOT NULL,
  sector TEXT NOT NULL,
  phone TEXT NOT NULL,
  images TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO listings (id, name, price, location, sector, phone, created_at) VALUES
  (1, 'Toyota RAV4 2020', 12500000.00, 'Lomé, Bè', 'Automobile', '90123456', '2026-05-24 10:08:39.586007+00'),
  (2, 'Villa F4 à Tokoin', 75000000.00, 'Lomé, Tokoin', 'Immobilier', '91234567', '2026-05-24 10:08:40.90225+00'),
  (3, 'Sacs de riz 50kg (lot de 10)', 350000.00, 'Kpalimé', 'AgriMarket', '92345678', '2026-05-24 10:08:42.327934+00'),
  (4, 'iPhone 14 Pro Max 256Go', 850000.00, 'Lomé, Adidogomé', 'Divers', '93456789', '2026-05-24 10:08:43.734926+00'),
  (5, 'Terrain 500m² à Agoè', 18000000.00, 'Lomé, Agoè', 'Immobilier', '94567890', '2026-05-24 10:08:44.893231+00'),
  (6, 'Moto Honda CB300R', 2800000.00, 'Lomé, Cacaveli', 'Automobile', '95678901', '2026-05-24 10:08:45.955822+00');

-- Table: orders
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  last_name TEXT NOT NULL,
  first_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
