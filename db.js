/**
 * db.js — PostgreSQL connection pool + helpers for SurfaBabe CRM
 *
 * BeastMode pattern: pg driver (no ORM), Pool, initDb() runs schema.sql + seeds products.
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const { Pool } = pg;

let pool = null;

export function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    pool.on('error', (err) => console.error('DB pool error:', err.message));
  }
  return pool;
}

export async function query(text, params) {
  return getPool().query(text, params);
}

/**
 * Initialize database: run schema.sql, seed products if empty.
 */
export async function initDb() {
  const p = getPool();

  // Run schema
  const schemaPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  await p.query(schema);
  console.log('Database schema initialized');

  // Seed products if table is empty
  const { rows } = await p.query('SELECT count(*)::int AS cnt FROM products');
  if (rows[0].cnt === 0) {
    await seedProducts();
  }
}

async function seedProducts() {
  const productsPath = path.join(
    process.env.KNOWLEDGE_DIR || './knowledge',
    'products.json'
  );
  let products;
  try {
    products = JSON.parse(fs.readFileSync(productsPath, 'utf-8'));
  } catch (err) {
    console.error('Cannot seed products — products.json not found:', err.message);
    return;
  }

  for (const p of products) {
    await query(
      `INSERT INTO products (id, name, name_vi, category, price, size, description, ingredients, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO NOTHING`,
      [p.id, p.name, p.nameVi || null, p.category, p.price, p.size, p.description, p.ingredients, true]
    );
  }
  // Sync sequence to max id
  await query(`SELECT setval('products_id_seq', (SELECT COALESCE(MAX(id),0) FROM products))`);
  console.log(`Seeded ${products.length} products`);
}

// ---- Customer helpers ----

export async function upsertCustomer(phone, name, language) {
  const { rows } = await query(
    `INSERT INTO customers (phone, name, language)
     VALUES ($1, $2, $3)
     ON CONFLICT (phone) DO UPDATE SET
       name = COALESCE(NULLIF($2, ''), customers.name),
       language = COALESCE(NULLIF($3, ''), customers.language),
       updated_at = NOW()
     RETURNING *`,
    [phone, name || null, language || null]
  );
  return rows[0];
}

export async function getCustomerByPhone(phone) {
  const { rows } = await query('SELECT * FROM customers WHERE phone = $1', [phone]);
  return rows[0] || null;
}

// ---- Order helpers ----

function generateOrderNumber() {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(3).toString('hex');
  return `SB-${ts}-${rand}`;
}

export async function createOrder(customerId, items, address, paymentMethod) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const orderNumber = generateOrderNumber();
    const subtotal = items.reduce((t, i) => t + i.unitPrice * i.quantity, 0);
    const total = subtotal; // shipping added later if needed

    const { rows } = await client.query(
      `INSERT INTO orders (order_number, customer_id, status, subtotal, total, delivery_address, payment_method)
       VALUES ($1, $2, 'confirmed', $3, $4, $5, $6) RETURNING *`,
      [orderNumber, customerId, subtotal, total, address || null, paymentMethod || null]
    );
    const order = rows[0];

    // Insert line items
    for (const item of items) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, subtotal)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [order.id, item.productId || null, item.productName, item.quantity, item.unitPrice, item.unitPrice * item.quantity]
      );
    }

    // Create pending payment
    if (paymentMethod) {
      await client.query(
        `INSERT INTO payments (order_id, amount, method, status) VALUES ($1, $2, $3, 'pending')`,
        [order.id, total, paymentMethod]
      );
    }

    await client.query('COMMIT');
    return order;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function updateOrderStatus(orderId, status) {
  await query('UPDATE orders SET status = $2, updated_at = NOW() WHERE id = $1', [orderId, status]);
}

export async function getOrderById(orderId) {
  const { rows } = await query('SELECT * FROM orders WHERE id = $1', [orderId]);
  return rows[0] || null;
}

export async function getOrderByNumber(orderNumber) {
  const { rows } = await query('SELECT * FROM orders WHERE order_number = $1', [orderNumber]);
  return rows[0] || null;
}

export async function getCustomerOrders(customerId) {
  const { rows } = await query(
    'SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC',
    [customerId]
  );
  return rows;
}

// ---- Payment helpers ----

export async function confirmPayment(orderId, reference) {
  await query(
    `UPDATE payments SET status = 'confirmed', reference = $2, confirmed_at = NOW()
     WHERE order_id = $1 AND status = 'pending'`,
    [orderId, reference || null]
  );
  await updateOrderStatus(orderId, 'paid');
}

// ---- CRM interaction helpers ----

export async function logInteraction(customerId, type, summary, metadata) {
  await query(
    `INSERT INTO crm_interactions (customer_id, type, summary, metadata) VALUES ($1, $2, $3, $4)`,
    [customerId, type, summary || null, metadata ? JSON.stringify(metadata) : null]
  );
}

// ---- Invoice helpers ----

function generateInvoiceNumber() {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(3).toString('hex');
  return `INV-${ts}-${rand}`;
}

export async function createInvoice(orderId, customerId, amount, dueDate) {
  const invoiceNumber = generateInvoiceNumber();
  const { rows } = await query(
    `INSERT INTO invoices (invoice_number, order_id, customer_id, amount, status, due_date)
     VALUES ($1, $2, $3, $4, 'draft', $5) RETURNING *`,
    [invoiceNumber, orderId, customerId, amount, dueDate || null]
  );
  return rows[0];
}

// ---- CRM query helpers (admin commands) ----

export async function getRecentCustomers(limit = 20) {
  const { rows } = await query(
    `SELECT c.*,
       (SELECT count(*) FROM orders WHERE customer_id = c.id) AS order_count,
       (SELECT COALESCE(sum(total), 0) FROM orders WHERE customer_id = c.id AND status NOT IN ('cancelled')) AS total_spent
     FROM customers c ORDER BY c.updated_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

export async function getRecentOrders(limit = 20) {
  const { rows } = await query(
    `SELECT o.*, c.name AS customer_name, c.phone AS customer_phone
     FROM orders o
     LEFT JOIN customers c ON o.customer_id = c.id
     ORDER BY o.created_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

export async function getOrderDetails(orderNumber) {
  const { rows: orderRows } = await query(
    `SELECT o.*, c.name AS customer_name, c.phone AS customer_phone
     FROM orders o
     LEFT JOIN customers c ON o.customer_id = c.id
     WHERE o.order_number = $1`,
    [orderNumber]
  );
  if (orderRows.length === 0) return null;
  const order = orderRows[0];

  const { rows: items } = await query(
    'SELECT * FROM order_items WHERE order_id = $1',
    [order.id]
  );
  const { rows: payments } = await query(
    'SELECT * FROM payments WHERE order_id = $1',
    [order.id]
  );
  return { ...order, items, payments };
}

export async function getCustomerProfile(phone) {
  const customer = await getCustomerByPhone(phone);
  if (!customer) return null;

  const orders = await getCustomerOrders(customer.id);
  const { rows: interactions } = await query(
    'SELECT * FROM crm_interactions WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 10',
    [customer.id]
  );
  return { ...customer, orders, interactions };
}

export async function addCustomerNote(phone, note) {
  const customer = await getCustomerByPhone(phone);
  if (!customer) return null;
  const existing = customer.notes || '';
  const timestamp = new Date().toISOString().split('T')[0];
  const updated = existing ? `${existing}\n[${timestamp}] ${note}` : `[${timestamp}] ${note}`;
  await query('UPDATE customers SET notes = $2, updated_at = NOW() WHERE id = $1', [customer.id, updated]);
  await logInteraction(customer.id, 'note', note);
  return { ...customer, notes: updated };
}

export async function addCustomerTag(phone, tag) {
  const customer = await getCustomerByPhone(phone);
  if (!customer) return null;
  await query(
    `UPDATE customers SET tags = array_append(
       COALESCE(tags, '{}'),
       $2
     ), updated_at = NOW()
     WHERE id = $1 AND NOT ($2 = ANY(COALESCE(tags, '{}')))`,
    [customer.id, tag.toLowerCase()]
  );
  const updated = await getCustomerByPhone(phone);
  return updated;
}

export async function removeCustomerTag(phone, tag) {
  const customer = await getCustomerByPhone(phone);
  if (!customer) return null;
  await query(
    'UPDATE customers SET tags = array_remove(COALESCE(tags, $3), $2), updated_at = NOW() WHERE id = $1',
    [customer.id, tag.toLowerCase(), '{}']
  );
  return await getCustomerByPhone(phone);
}

export async function getCustomerStats() {
  const { rows } = await query(`
    SELECT
      (SELECT count(*) FROM customers) AS total_customers,
      (SELECT count(*) FROM orders) AS total_orders,
      (SELECT count(*) FROM orders WHERE status = 'confirmed') AS pending_orders,
      (SELECT count(*) FROM orders WHERE status = 'paid') AS paid_orders,
      (SELECT COALESCE(sum(total), 0) FROM orders WHERE status NOT IN ('cancelled')) AS total_revenue,
      (SELECT count(*) FROM payments WHERE status = 'pending') AS pending_payments
  `);
  return rows[0];
}

// ---- Health check ----

export async function dbHealthCheck() {
  try {
    const { rows } = await query('SELECT 1 AS ok');
    return { connected: true, ok: rows[0].ok === 1 };
  } catch (err) {
    return { connected: false, error: err.message };
  }
}
