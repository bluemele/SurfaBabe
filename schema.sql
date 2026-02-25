-- SurfaBabe Wellness — CRM + Accounting Database Schema
-- PostgreSQL 16

-- Customers (primary identifier: WhatsApp JID / phone)
CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  phone VARCHAR UNIQUE NOT NULL,
  name VARCHAR,
  email VARCHAR,
  language VARCHAR(5) DEFAULT 'en',
  notes TEXT,
  tags TEXT[],
  source VARCHAR DEFAULT 'whatsapp',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Products catalog (seeded from products.json on first run)
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name VARCHAR NOT NULL,
  name_vi VARCHAR,
  category VARCHAR,
  price INTEGER NOT NULL,
  size VARCHAR,
  description TEXT,
  ingredients TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Orders
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  order_number VARCHAR UNIQUE NOT NULL,
  customer_id INTEGER REFERENCES customers ON DELETE SET NULL,
  status VARCHAR NOT NULL DEFAULT 'pending',
  subtotal INTEGER,
  shipping_cost INTEGER DEFAULT 0,
  total INTEGER,
  delivery_address TEXT,
  payment_method VARCHAR,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Order line items (snapshots at order time)
CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders ON DELETE CASCADE,
  product_id INTEGER REFERENCES products ON DELETE SET NULL,
  product_name VARCHAR NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price INTEGER NOT NULL,
  subtotal INTEGER NOT NULL
);

-- Payments
CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  method VARCHAR NOT NULL,
  status VARCHAR DEFAULT 'pending',
  reference VARCHAR,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Invoices
CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  invoice_number VARCHAR UNIQUE NOT NULL,
  order_id INTEGER REFERENCES orders,
  customer_id INTEGER REFERENCES customers,
  amount INTEGER NOT NULL,
  status VARCHAR DEFAULT 'draft',
  due_date DATE,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- CRM interaction log (replaces HubSpot timeline)
CREATE TABLE IF NOT EXISTS crm_interactions (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers ON DELETE CASCADE,
  type VARCHAR NOT NULL,
  summary TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_order ON invoices(order_id);
CREATE INDEX IF NOT EXISTS idx_crm_customer ON crm_interactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_crm_type ON crm_interactions(type);
